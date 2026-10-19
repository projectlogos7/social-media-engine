import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Storage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements Storage {
  constructor(private root: string) {}
  private path(key: string) {
    const p = resolve(this.root, key);
    if (!p.startsWith(resolve(this.root))) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, bytes: Uint8Array) {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }
  async get(key: string) {
    return readFile(this.path(key));
  }
  async delete(key: string) {
    await unlink(this.path(key)).catch(() => {});
  }
}

/** Any S3-compatible store (AWS S3, Cloudflare R2, MinIO). */
class S3Storage implements Storage {
  private s3: S3Client;
  constructor(private bucket: string) {
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? "auto",
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
      credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "" } : undefined,
    });
  }
  async put(key: string, bytes: Uint8Array, contentType: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }));
  }
  async get(key: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
  async delete(key: string) {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let instance: Storage | undefined;

/** DATA_DIR, else <repo root>/data (found by walking up to pnpm-workspace.yaml), else ./data. */
export function dataDir(): string {
  if (process.env.DATA_DIR) return resolve(process.env.DATA_DIR);
  for (let d = process.cwd(); d !== dirname(d); d = dirname(d)) if (existsSync(join(d, "pnpm-workspace.yaml"))) return join(d, "data");
  return resolve("data");
}

export function getStorage(): Storage {
  if (!instance) instance = process.env.S3_BUCKET ? new S3Storage(process.env.S3_BUCKET) : new LocalStorage(join(dataDir(), "files"));
  return instance;
}

const EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg", "image/gif": "gif", "application/pdf": "pdf", "application/zip": "zip", "font/woff2": "woff2", "font/woff": "woff", "font/ttf": "ttf", "font/otf": "otf" };

/** Content-addressed key: identical bytes are stored once per project. */
export function contentKey(scope: string, sha: string, contentType: string): string {
  return `${scope}/${sha.slice(0, 2)}/${sha}.${EXT[contentType] ?? "bin"}`;
}
