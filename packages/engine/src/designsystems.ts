import { and, desc, eq, max } from "drizzle-orm";
import type { TokensFile } from "@sme/core";
import {
  type BundleComponent,
  type DesignSystemBundle,
  type BrandRules,
  compileTokensCss,
  paletteColors,
  dataUri,
  deriveBrandRules,
  importFromFiles,
  importFromSingleHtml,
  importFromZip,
  themeIds,
  type FileMap,
} from "@sme/design";
import { contentKey, type DB, designSystemVersions, dsFiles, getStorage, projects } from "@sme/db";
import { sha256 } from "@sme/core/hash";
import { assertProject, type Actor } from "./access";
import { EngineError, NotFound } from "./errors";
import { Lru } from "./runtime";

export type DsVersion = typeof designSystemVersions.$inferSelect;

/** Parses an upload: a zip, the one-file page HTML, or a set of files from a folder picker. */
export function parseUpload(input: { zip?: Uint8Array; html?: string; files?: FileMap }): DesignSystemBundle {
  if (input.zip) return importFromZip(input.zip);
  if (input.html) return importFromSingleHtml(input.html);
  if (input.files) return importFromFiles(input.files);
  throw new EngineError("Upload the design system export (zip, folder or the design system's HTML file).");
}

/** Stores a bundle as the next (draft) version of the project's design system. */
export async function saveDesignSystemVersion(db: DB, actor: Actor, projectId: string, bundle: DesignSystemBundle, note = ""): Promise<DsVersion> {
  await assertProject(db, actor, projectId, "designsystem.manage");
  const storage = getStorage();
  const [{ v }] = await db.select({ v: max(designSystemVersions.version) }).from(designSystemVersions).where(eq(designSystemVersions.projectId, projectId));
  const [version] = await db
    .insert(designSystemVersions)
    .values({
      projectId,
      version: (v ?? 0) + 1,
      name: bundle.name,
      namespace: bundle.namespace,
      tokens: bundle.tokens,
      readme: bundle.readme,
      sections: bundle.sections,
      voice: bundle.voice,
      groupNotes: bundle.groupNotes,
      components: bundle.components,
      warnings: bundle.warnings,
      status: "draft",
      note,
      createdBy: actor.userId,
    })
    .returning();
  const files = [
    ...bundle.fonts.map((f) => ({ ...f, kind: "font", group: "", name: f.path.split("/").pop()! })),
    ...bundle.assets.map((a) => ({ ...a, kind: "asset" })),
  ];
  for (const f of files) {
    const sha = sha256(f.bytes);
    const key = contentKey(`p/${projectId}/ds`, sha, f.contentType);
    await storage.put(key, f.bytes, f.contentType);
    await db.insert(dsFiles).values({ versionId: version.id, kind: f.kind, path: f.path, group: f.group, name: f.name, contentType: f.contentType, size: f.bytes.length, sha256: sha, storageKey: key });
  }
  return version;
}

/** Publishing locks the version and makes it the one new posts use. */
export async function publishDesignSystemVersion(db: DB, actor: Actor, versionId: string) {
  const [v] = await db.select().from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  if (!v) throw new NotFound("Design system version");
  await assertProject(db, actor, v.projectId, "designsystem.manage");
  await db.update(designSystemVersions).set({ status: "published", publishedAt: v.publishedAt ?? new Date() }).where(eq(designSystemVersions.id, versionId));
  await db.update(projects).set({ currentDesignSystemVersionId: versionId }).where(eq(projects.id, v.projectId));
}

export async function deleteDraftVersion(db: DB, actor: Actor, versionId: string) {
  const [v] = await db.select().from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  if (!v) throw new NotFound("Design system version");
  await assertProject(db, actor, v.projectId, "designsystem.manage");
  if (v.status !== "draft") throw new EngineError("Published versions are kept so earlier posts can be re-rendered exactly.");
  await db.delete(designSystemVersions).where(eq(designSystemVersions.id, versionId));
}

export async function listDesignSystemVersions(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "view");
  return db
    .select({ id: designSystemVersions.id, version: designSystemVersions.version, name: designSystemVersions.name, status: designSystemVersions.status, note: designSystemVersions.note, warnings: designSystemVersions.warnings, createdAt: designSystemVersions.createdAt, publishedAt: designSystemVersions.publishedAt })
    .from(designSystemVersions)
    .where(eq(designSystemVersions.projectId, projectId))
    .orderBy(desc(designSystemVersions.version));
}

export async function getDesignSystemVersion(db: DB, actor: Actor, versionId: string) {
  const [v] = await db.select().from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  if (!v) throw new NotFound("Design system version");
  await assertProject(db, actor, v.projectId, "view");
  const files = await db.select().from(dsFiles).where(eq(dsFiles.versionId, versionId));
  return { ...v, files };
}

/** Everything the renderer and the copywriter need from one design-system version. */
export interface DsRuntime {
  version: DsVersion;
  tokens: TokensFile;
  tokensCss: string;
  themes: string[];
  rules: BrandRules;
  palette: string[];
  assetPaths: Set<string>;
  assetUrl: (path: string) => string | null;
  assetList: { path: string; group: string; name: string; contentType: string; storageKey: string }[];
  components: BundleComponent[];
}

const runtimeCache = new Lru<string, DsRuntime>(20);

/** Versions are immutable, so the compiled runtime is cached by id. No permission check: callers check. */
export async function loadDsRuntime(db: DB, versionId: string): Promise<DsRuntime> {
  const hit = runtimeCache.get(versionId);
  if (hit) return hit;
  const [version] = await db.select().from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  if (!version) throw new NotFound("Design system version");
  const files = await db.select().from(dsFiles).where(eq(dsFiles.versionId, versionId));
  const storage = getStorage();
  const uris = new Map<string, string>();
  for (const f of files) uris.set(f.path, dataUri(f.contentType, await storage.get(f.storageKey)));
  const tokens = version.tokens as TokensFile;
  const compiled = compileTokensCss(tokens, { fontSrc: (p) => uris.get(p) ?? null });
  const rt: DsRuntime = {
    version,
    tokens,
    tokensCss: compiled.css,
    themes: themeIds(tokens),
    rules: deriveBrandRules(tokens),
    palette: paletteColors(tokens).map((c) => c.value),
    assetPaths: new Set(files.filter((f) => f.kind === "asset").map((f) => f.path)),
    assetUrl: (p) => uris.get(p) ?? null,
    assetList: files.filter((f) => f.kind === "asset").map((f) => ({ path: f.path, group: f.group, name: f.name, contentType: f.contentType, storageKey: f.storageKey })),
    components: (version.components as BundleComponent[]) ?? [],
  };
  runtimeCache.set(versionId, rt);
  return rt;
}

export async function currentDsVersionId(db: DB, projectId: string): Promise<string> {
  const [p] = await db.select({ v: projects.currentDesignSystemVersionId }).from(projects).where(eq(projects.id, projectId));
  if (!p?.v) throw new EngineError("This project has no published design system yet. Import and publish one first.");
  return p.v;
}

export async function getDsFile(db: DB, actor: Actor, versionId: string, path: string) {
  const [f] = await db.select().from(dsFiles).where(and(eq(dsFiles.versionId, versionId), eq(dsFiles.path, path)));
  if (!f) throw new NotFound("File");
  const [v] = await db.select({ projectId: designSystemVersions.projectId }).from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  await assertProject(db, actor, v.projectId, "view");
  return { file: f, bytes: await getStorage().get(f.storageKey) };
}
