import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

function secret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 16) {
    if (process.env.NODE_ENV === "production") throw new Error("APP_SECRET must be set (at least 16 characters).");
    return "dev-only-secret-change-me";
  }
  return s;
}

function key(): Buffer {
  return createHash("sha256").update(`enc:${secret()}`).digest();
}

/** AES-256-GCM for API keys and OAuth tokens at rest. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(token: string): string {
  const [v, iv, tag, body] = token.split(".");
  if (v !== "v1") throw new Error("Unknown encryption format");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(pw, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [alg, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64url");
  const actual = await scryptAsync(pw, Buffer.from(salt, "base64url"), expected.length);
  return timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Signed, expiring links (public file URLs for Instagram to fetch). */
export function sign(payload: string, expiresAt: number): string {
  const mac = createHmac("sha256", `sign:${secret()}`).update(`${payload}.${expiresAt}`).digest("base64url");
  return `${expiresAt}.${mac}`;
}

export function verifySignature(payload: string, sig: string): boolean {
  const [exp, mac] = sig.split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const expected = createHmac("sha256", `sign:${secret()}`).update(`${payload}.${exp}`).digest("base64url");
  return expected.length === mac.length && timingSafeEqual(Buffer.from(expected), Buffer.from(mac));
}
