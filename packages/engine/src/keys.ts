import { and, eq } from "drizzle-orm";
import { type DB, decrypt, encrypt, providerKeys } from "@sme/db";
import { assertWorkspace, type Actor } from "./access";
import { EngineError } from "./errors";

export const KEY_PROVIDERS = {
  anthropic: { label: "Anthropic (Claude, copywriting)", env: "ANTHROPIC_API_KEY" },
  openai: { label: "OpenAI (gpt-image)", env: "OPENAI_API_KEY" },
  google: { label: "Google AI (Imagen)", env: "GOOGLE_API_KEY" },
  flux: { label: "fal.ai (FLUX)", env: "FAL_KEY" },
  ideogram: { label: "Ideogram", env: "IDEOGRAM_API_KEY" },
} as const;
export type KeyProvider = keyof typeof KEY_PROVIDERS;

export async function setProviderKey(db: DB, actor: Actor, provider: string, key: string) {
  await assertWorkspace(db, actor, "keys.manage");
  if (!(provider in KEY_PROVIDERS)) throw new EngineError("Unknown provider.");
  const value = key.trim();
  if (!value) {
    await db.delete(providerKeys).where(and(eq(providerKeys.workspaceId, actor.workspaceId), eq(providerKeys.provider, provider)));
    return;
  }
  const hint = `…${value.slice(-4)}`;
  await db
    .insert(providerKeys)
    .values({ workspaceId: actor.workspaceId, provider, encrypted: encrypt(value), hint })
    .onConflictDoUpdate({ target: [providerKeys.workspaceId, providerKeys.provider], set: { encrypted: encrypt(value), hint, updatedAt: new Date() } });
}

/** Workspace key first, then the server environment. Never returned to the browser. */
export async function getProviderKey(db: DB, workspaceId: string, provider: string): Promise<string | undefined> {
  const [row] = await db.select().from(providerKeys).where(and(eq(providerKeys.workspaceId, workspaceId), eq(providerKeys.provider, provider)));
  if (row) return decrypt(row.encrypted);
  const env = KEY_PROVIDERS[provider as KeyProvider]?.env;
  return env ? process.env[env] || undefined : undefined;
}

export async function listProviderKeys(db: DB, actor: Actor) {
  await assertWorkspace(db, actor, "view");
  const rows = await db.select().from(providerKeys).where(eq(providerKeys.workspaceId, actor.workspaceId));
  return Object.entries(KEY_PROVIDERS).map(([id, p]) => {
    const row = rows.find((r) => r.provider === id);
    return { id, label: p.label, hint: row?.hint ?? (process.env[p.env] ? "server default" : null), source: row ? "workspace" : process.env[p.env] ? "env" : null };
  });
}
