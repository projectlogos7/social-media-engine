import { and, desc, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { sha256 } from "@sme/core";
import { dataUri } from "@sme/design";
import { assets, contentKey, type DB, getStorage } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { EngineError, NotFound } from "./errors";
import { Lru } from "./runtime";

export type Asset = typeof assets.$inferSelect;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"]);

export async function storeImage(
  db: DB,
  projectId: string,
  bytes: Buffer,
  meta: { kind: string; name?: string; contentType?: string; generation?: unknown; paletteDistance?: number | null; approved?: boolean; sourceUrl?: string; createdBy?: string | null; tags?: string[] },
): Promise<Asset> {
  let contentType = meta.contentType ?? "image/png";
  let body = bytes;
  let width: number | undefined;
  let height: number | undefined;
  try {
    const m = await sharp(bytes).metadata();
    width = m.width;
    height = m.height;
    // Normalise exotic formats to PNG so every renderer and platform can read them.
    if (m.format && !["png", "jpeg", "webp", "gif", "svg"].includes(m.format)) {
      body = await sharp(bytes).png().toBuffer();
      contentType = "image/png";
    } else if (m.format) contentType = m.format === "svg" ? "image/svg+xml" : `image/${m.format}`;
  } catch {
    throw new EngineError("That file is not an image this engine can read.");
  }
  if (!ALLOWED.has(contentType)) throw new EngineError("Upload PNG, JPEG, WebP, GIF, AVIF or SVG images.");
  const sha = sha256(body);
  const key = contentKey(`p/${projectId}/assets`, sha, contentType);
  await getStorage().put(key, body, contentType);
  const [a] = await db
    .insert(assets)
    .values({
      projectId,
      kind: meta.kind,
      name: meta.name ?? "",
      storageKey: key,
      contentType,
      width,
      height,
      sha256: sha,
      generation: meta.generation ?? null,
      paletteDistance: meta.paletteDistance ?? null,
      approved: meta.approved ?? meta.kind === "upload",
      sourceUrl: meta.sourceUrl,
      tags: meta.tags ?? [],
      createdBy: meta.createdBy ?? null,
    })
    .returning();
  return a;
}

export async function uploadAsset(db: DB, actor: Actor, projectId: string, bytes: Buffer, name: string, tags: string[] = []) {
  await assertProject(db, actor, projectId, "post.create");
  if (bytes.length > 25 * 1024 * 1024) throw new EngineError("Images can be at most 25 MB.");
  return storeImage(db, projectId, bytes, { kind: "upload", name, createdBy: actor.userId, approved: true, tags });
}

export async function listAssets(db: DB, actor: Actor, projectId: string, opts: { kind?: string; approvedOnly?: boolean } = {}) {
  await assertProject(db, actor, projectId, "view");
  const conds = [eq(assets.projectId, projectId)];
  if (opts.kind) conds.push(eq(assets.kind, opts.kind));
  if (opts.approvedOnly) conds.push(eq(assets.approved, true));
  return db.select().from(assets).where(and(...conds)).orderBy(desc(assets.createdAt)).limit(500);
}

export async function getAsset(db: DB, actor: Actor, assetId: string) {
  const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!a) throw new NotFound("Image");
  await assertProject(db, actor, a.projectId, "view");
  return { asset: a, bytes: await getStorage().get(a.storageKey) };
}

export async function setAssetApproved(db: DB, actor: Actor, assetId: string, approved: boolean) {
  const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!a) throw new NotFound("Image");
  await assertProject(db, actor, a.projectId, "post.create");
  await db.update(assets).set({ approved }).where(eq(assets.id, assetId));
}

export async function deleteAsset(db: DB, actor: Actor, assetId: string) {
  const [a] = await db.select().from(assets).where(eq(assets.id, assetId));
  if (!a) throw new NotFound("Image");
  await assertProject(db, actor, a.projectId, "post.create");
  await db.delete(assets).where(eq(assets.id, assetId));
}

const uriCache = new Lru<string, string>(200);

/** assetId -> data URI for every image a render needs, restricted to one project. */
export async function imageResolver(db: DB, projectId: string, ids: string[]): Promise<(id: string) => string | null> {
  const unique = [...new Set(ids)].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  const rows = unique.length ? await db.select().from(assets).where(and(eq(assets.projectId, projectId), inArray(assets.id, unique))) : [];
  const map = new Map<string, string>();
  for (const r of rows) {
    let uri = uriCache.get(r.id);
    if (!uri) {
      uri = dataUri(r.contentType, await getStorage().get(r.storageKey));
      uriCache.set(r.id, uri);
    }
    map.set(r.id, uri);
  }
  return (id) => map.get(id) ?? null;
}
