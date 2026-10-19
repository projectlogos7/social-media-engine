import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { ENGINE_VERSION, FORMATS, type FormatId, type ImageGenerationRecord, type QualityReport, type Recipe, type SlotValues, type TemplateSpec, isImageRef } from "@sme/core";
import { recipeHash, sha256 } from "@sme/core/hash";
import { assets, contentKey, type DB, getStorage, postPages, posts, projects, publications, renders, templates, templateVersions } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { currentDsVersionId, loadDsRuntime } from "./designsystems";
import { EngineError, NotFound } from "./errors";
import { imageResolver } from "./assets";
import { getRenderer } from "./runtime";

export type Post = typeof posts.$inferSelect;
export type PostPage = typeof postPages.$inferSelect;
export type RenderRow = typeof renders.$inferSelect;

export interface NewPage {
  templateVersionId: string;
  slots: SlotValues;
}

export interface NewPost {
  title?: string;
  pages: NewPage[];
  formats: FormatId[];
  brief?: string;
  caption?: string;
  hashtags?: string[];
  altText?: string;
  sourceUrls?: string[];
  copyMeta?: unknown;
  batchId?: string | null;
}

/** The headline-like slot, else the longest text. */
function defaultTitle(slots: SlotValues): string {
  for (const k of ["headline", "title", "quote", "label"]) {
    const v = slots[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const texts = Object.values(slots).filter((v): v is string => typeof v === "string" && !!v.trim());
  return texts.sort((a, b) => b.length - a.length)[0] ?? "Untitled post";
}

async function pageSpecs(db: DB, projectId: string, pages: NewPage[]) {
  const ids = [...new Set(pages.map((p) => p.templateVersionId))];
  const rows = await db
    .select({ v: templateVersions, t: templates })
    .from(templateVersions)
    .innerJoin(templates, eq(templates.id, templateVersions.templateId))
    .where(inArray(templateVersions.id, ids));
  const map = new Map(rows.map((r) => [r.v.id, r]));
  for (const id of ids) {
    const r = map.get(id);
    if (!r || r.t.projectId !== projectId) throw new EngineError("A page uses a template that does not belong to this project.");
  }
  return map;
}

export async function createPost(db: DB, actor: Actor, projectId: string, input: NewPost): Promise<Post> {
  await assertProject(db, actor, projectId, "post.create");
  if (!input.pages.length) throw new EngineError("A post needs at least one page.");
  if (input.pages.length > 10) throw new EngineError("Carousels hold at most 10 pages.");
  if (!input.formats.length) throw new EngineError("Choose at least one format.");
  const specs = await pageSpecs(db, projectId, input.pages);
  for (const p of input.pages) {
    const spec = specs.get(p.templateVersionId)!.v.spec as TemplateSpec;
    const unsupported = input.formats.filter((f) => !spec.formats.includes(f));
    if (unsupported.length) throw new EngineError(`"${spec.name}" does not support ${unsupported.map((f) => FORMATS[f].label.split(" ·")[0]).join(", ")}.`);
  }
  const dsVersionId = await currentDsVersionId(db, projectId);
  return db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({
        projectId,
        title: (input.title?.trim() || defaultTitle(input.pages[0].slots)).slice(0, 120),
        kind: input.pages.length > 1 ? "carousel" : "single",
        brief: input.brief ?? "",
        caption: input.caption ?? "",
        hashtags: input.hashtags ?? [],
        altText: input.altText ?? "",
        sourceUrls: input.sourceUrls ?? [],
        formats: input.formats,
        designSystemVersionId: dsVersionId,
        copyMeta: input.copyMeta ?? null,
        batchId: input.batchId ?? null,
        createdBy: actor.userId,
      })
      .returning();
    await tx.insert(postPages).values(input.pages.map((p, index) => ({ postId: post.id, index, templateVersionId: p.templateVersionId, slots: p.slots })));
    return post;
  });
}

async function loadPost(db: DB, postId: string) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new NotFound("Post");
  const pages = await db.select().from(postPages).where(eq(postPages.postId, postId)).orderBy(asc(postPages.index));
  return { post, pages };
}

export async function getPost(db: DB, actor: Actor, postId: string) {
  const { post, pages } = await loadPost(db, postId);
  const role = await assertProject(db, actor, post.projectId, "view");
  const tv = pages.length
    ? await db
        .select({ v: templateVersions, t: templates })
        .from(templateVersions)
        .innerJoin(templates, eq(templates.id, templateVersions.templateId))
        .where(inArray(templateVersions.id, pages.map((p) => p.templateVersionId)))
    : [];
  const all = await db.select().from(renders).where(eq(renders.postId, postId)).orderBy(desc(renders.createdAt));
  const latest = new Map<string, RenderRow>();
  for (const r of all) {
    const k = `${r.pageId}:${r.format}`;
    if (!latest.has(k)) latest.set(k, r);
  }
  const pubs = await db.select().from(publications).where(eq(publications.postId, postId)).orderBy(desc(publications.scheduledAt));
  return {
    post,
    role,
    pages: pages.map((p) => {
      const t = tv.find((x) => x.v.id === p.templateVersionId)!;
      return {
        ...p,
        slots: p.slots as SlotValues,
        template: { id: t.t.id, name: t.t.name, version: t.v.version, currentVersionId: t.t.currentVersionId, spec: t.v.spec as TemplateSpec },
        renders: Object.fromEntries((post.formats as FormatId[]).map((f) => [f, latest.get(`${p.id}:${f}`) ?? null])),
      };
    }),
    history: all,
    publications: pubs,
  };
}

export async function listPosts(db: DB, actor: Actor, projectId: string, opts: { status?: string; batchId?: string; limit?: number } = {}) {
  await assertProject(db, actor, projectId, "view");
  const conds = [eq(posts.projectId, projectId)];
  if (opts.status) conds.push(eq(posts.status, opts.status));
  if (opts.batchId) conds.push(eq(posts.batchId, opts.batchId));
  const rows = await db.select().from(posts).where(and(...conds)).orderBy(desc(posts.createdAt)).limit(opts.limit ?? 200);
  if (!rows.length) return [];
  // thumbnail: latest render of page 0 in the first format
  const rs = await db
    .select({ id: renders.id, postId: renders.postId, format: renders.format, passed: renders.passed, pageId: renders.pageId, createdAt: renders.createdAt })
    .from(renders)
    .where(inArray(renders.postId, rows.map((r) => r.id)))
    .orderBy(desc(renders.createdAt));
  const firstPages = await db.select().from(postPages).where(and(inArray(postPages.postId, rows.map((r) => r.id)), eq(postPages.index, 0)));
  return rows.map((p) => {
    const page = firstPages.find((x) => x.postId === p.id);
    const thumb = rs.find((r) => r.postId === p.id && r.pageId === page?.id && r.format === (p.formats as string[])[0]);
    const latestPerKey = new Map<string, boolean>();
    for (const r of rs.filter((r) => r.postId === p.id)) if (!latestPerKey.has(`${r.pageId}:${r.format}`)) latestPerKey.set(`${r.pageId}:${r.format}`, r.passed);
    return { ...p, thumbnailRenderId: thumb?.id ?? null, allPassed: latestPerKey.size > 0 && [...latestPerKey.values()].every(Boolean) };
  });
}

export interface PostUpdate {
  title?: string;
  caption?: string;
  hashtags?: string[];
  altText?: string;
  formats?: FormatId[];
  pages?: { id: string; slots?: SlotValues; templateVersionId?: string }[];
  /** Move every page to its template's current version. */
  upgradeTemplates?: boolean;
  /** Move the post to the project's current design system. */
  upgradeDesignSystem?: boolean;
}

export async function updatePost(db: DB, actor: Actor, postId: string, u: PostUpdate) {
  const { post, pages } = await loadPost(db, postId);
  await assertProject(db, actor, post.projectId, "post.create");
  const set: Partial<Post> = { updatedAt: new Date() };
  if (u.title !== undefined) set.title = u.title;
  if (u.caption !== undefined) set.caption = u.caption;
  if (u.hashtags !== undefined) set.hashtags = u.hashtags;
  if (u.altText !== undefined) set.altText = u.altText;
  if (u.formats) set.formats = u.formats;
  if (u.upgradeDesignSystem) set.designSystemVersionId = await currentDsVersionId(db, post.projectId);
  await db.update(posts).set(set).where(eq(posts.id, postId));
  for (const pu of u.pages ?? []) {
    const page = pages.find((p) => p.id === pu.id);
    if (!page) throw new NotFound("Page");
    if (pu.templateVersionId) await pageSpecs(db, post.projectId, [{ templateVersionId: pu.templateVersionId, slots: {} }]);
    await db
      .update(postPages)
      .set({ ...(pu.slots ? { slots: pu.slots } : {}), ...(pu.templateVersionId ? { templateVersionId: pu.templateVersionId } : {}) })
      .where(eq(postPages.id, pu.id));
  }
  if (u.upgradeTemplates) {
    for (const p of pages) {
      const [row] = await db.select({ current: templates.currentVersionId }).from(templateVersions).innerJoin(templates, eq(templates.id, templateVersions.templateId)).where(eq(templateVersions.id, p.templateVersionId));
      if (row?.current && row.current !== p.templateVersionId) await db.update(postPages).set({ templateVersionId: row.current }).where(eq(postPages.id, p.id));
    }
  }
}

export async function deletePost(db: DB, actor: Actor, postId: string) {
  const { post } = await loadPost(db, postId);
  await assertProject(db, actor, post.projectId, "post.create");
  await db.delete(posts).where(eq(posts.id, postId));
}

export async function duplicatePost(db: DB, actor: Actor, postId: string) {
  const { post, pages } = await loadPost(db, postId);
  return createPost(db, actor, post.projectId, {
    title: `${post.title} (copy)`,
    pages: pages.map((p) => ({ templateVersionId: p.templateVersionId, slots: p.slots as SlotValues })),
    formats: post.formats as FormatId[],
    brief: post.brief,
    caption: post.caption,
    hashtags: post.hashtags as string[],
    altText: post.altText,
    sourceUrls: post.sourceUrls as string[],
  });
}

/** Builds the recipe for one page in one format. */
async function buildRecipe(db: DB, post: Post, page: PostPage, spec: TemplateSpec, format: FormatId, dsVersionId: string, themes: string[]): Promise<Recipe> {
  const slots = page.slots as SlotValues;
  const imageIds = Object.values(slots).filter(isImageRef).map((v) => v.assetId);
  const gens = imageIds.length ? await db.select({ id: assets.id, generation: assets.generation }).from(assets).where(inArray(assets.id, imageIds)) : [];
  const meta = post.copyMeta as { model?: string } | null;
  return {
    engineVersion: ENGINE_VERSION,
    designSystemVersionId: dsVersionId,
    templateVersionId: page.templateVersionId,
    format,
    theme: spec.theme || themes[0],
    slots,
    images: Object.fromEntries(gens.filter((g) => g.generation).map((g) => [g.id, g.generation as ImageGenerationRecord])),
    copy: meta?.model ? { model: meta.model, brief: post.brief, sourceUrls: post.sourceUrls as string[] } : undefined,
  };
}

export interface RenderOptions {
  formats?: FormatId[];
  /** Render with another design-system version (comparison); does not change the post. */
  designSystemVersionId?: string;
  createdBy?: string | null;
}

/** Renders every page in every requested format. Identical recipes reuse the stored PNG. */
export async function renderPostInternal(db: DB, postId: string, opts: RenderOptions = {}): Promise<RenderRow[]> {
  const { post, pages } = await loadPost(db, postId);
  const dsVersionId = opts.designSystemVersionId ?? post.designSystemVersionId;
  const rt = await loadDsRuntime(db, dsVersionId);
  const [project] = await db.select().from(projects).where(eq(projects.id, post.projectId));
  const bannedWords = ((project.settings as { voice?: { bannedWords?: string[] } })?.voice?.bannedWords ?? []) as string[];
  const formats = opts.formats ?? (post.formats as FormatId[]);
  const specs = await pageSpecs(db, post.projectId, pages.map((p) => ({ templateVersionId: p.templateVersionId, slots: {} })));
  const imageUrl = await imageResolver(db, post.projectId, pages.flatMap((p) => Object.values(p.slots as SlotValues).filter(isImageRef).map((v) => v.assetId)));
  const renderer = await getRenderer();
  const out: RenderRow[] = [];
  for (const page of pages) {
    const spec = specs.get(page.templateVersionId)!.v.spec as TemplateSpec;
    for (const format of formats) {
      if (!spec.formats.includes(format)) continue;
      const recipe = await buildRecipe(db, post, page, spec, format, dsVersionId, rt.themes);
      const hash = recipeHash(recipe);
      const [existing] = await db.select().from(renders).where(and(eq(renders.postId, postId), eq(renders.recipeHash, hash), eq(renders.pageId, page.id))).limit(1);
      if (existing) {
        out.push(existing);
        continue;
      }
      const res = await renderer.render({
        tokensCss: rt.tokensCss,
        theme: recipe.theme,
        format: FORMATS[format],
        template: spec,
        slots: recipe.slots,
        assetUrl: rt.assetUrl,
        imageUrl,
        rules: rt.rules,
        bannedWords,
        page: pages.length > 1 ? { index: page.index + 1, count: pages.length } : undefined,
        vars: { project: project.name, handle: project.handle },
      });
      const sha = sha256(res.png);
      const key = contentKey(`p/${post.projectId}/renders`, sha, "image/png");
      await getStorage().put(key, res.png, "image/png");
      const [row] = await db
        .insert(renders)
        .values({ postId, pageId: page.id, format, recipe, recipeHash: hash, storageKey: key, sha256: sha, report: res.report, passed: res.report.passed, createdBy: opts.createdBy ?? null })
        .returning();
      out.push(row);
    }
  }
  return out;
}

export async function renderPost(db: DB, actor: Actor, postId: string, opts: RenderOptions = {}) {
  const { post } = await loadPost(db, postId);
  await assertProject(db, actor, post.projectId, "post.create");
  return renderPostInternal(db, postId, { ...opts, createdBy: actor.userId });
}

export async function getRenderFile(db: DB, actor: Actor | null, renderId: string) {
  const [r] = await db.select().from(renders).where(eq(renders.id, renderId));
  if (!r) throw new NotFound("Render");
  if (actor) {
    const [p] = await db.select({ projectId: posts.projectId }).from(posts).where(eq(posts.id, r.postId));
    await assertProject(db, actor, p.projectId, "view");
  }
  return { render: r, bytes: await getStorage().get(r.storageKey) };
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "post";
}

export function captionText(post: Post): string {
  const tags = (post.hashtags as string[]).map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" ");
  return [post.caption.trim(), tags].filter(Boolean).join("\n\n");
}

/**
 * Exports a post in one format: a PNG for single posts, a ZIP of numbered PNGs
 * or a PDF for carousels. Renders first if needed; refuses if any gate fails
 * unless `force` is set. Marks the renders as saved in the library.
 */
export async function exportPost(db: DB, actor: Actor, postId: string, format: FormatId, kind: "png" | "zip" | "pdf" = "png", force = false) {
  const { post, pages } = await loadPost(db, postId);
  await assertProject(db, actor, post.projectId, "post.create");
  const rows = await renderPostInternal(db, postId, { formats: [format], createdBy: actor.userId });
  const ordered = pages.map((p) => rows.find((r) => r.pageId === p.id && r.format === format)).filter((r): r is RenderRow => !!r);
  if (!ordered.length) throw new EngineError("This post has no page that supports that format.");
  const failed = ordered.filter((r) => !r.passed);
  if (failed.length && !force) {
    const msgs = failed.flatMap((r) => (r.report as QualityReport).issues.filter((i) => i.severity === "error").map((i) => i.message));
    throw new EngineError(`This post does not pass its quality checks yet:\n${[...new Set(msgs)].map((m) => `• ${m}`).join("\n")}`, 422, msgs);
  }
  await db.update(renders).set({ saved: true }).where(inArray(renders.id, ordered.map((r) => r.id)));
  if (post.status === "draft") await db.update(posts).set({ status: "ready", updatedAt: new Date() }).where(eq(posts.id, postId));
  const storage = getStorage();
  const files = await Promise.all(ordered.map((r) => storage.get(r.storageKey)));
  const base = `${slug(post.title)}-${format}`;
  if (ordered.length === 1 && kind === "png") return { filename: `${base}.png`, contentType: "image/png", bytes: files[0] };
  if (kind === "pdf") {
    const renderer = await getRenderer();
    return { filename: `${base}.pdf`, contentType: "application/pdf", bytes: await renderer.pdf(files, FORMATS[format]) };
  }
  const zip = zipSync({
    ...Object.fromEntries(files.map((b, i) => [`${base}-${String(i + 1).padStart(2, "0")}.png`, new Uint8Array(b)])),
    "caption.txt": strToU8(captionText(post)),
    "alt-text.txt": strToU8(post.altText),
  });
  return { filename: `${base}.zip`, contentType: "application/zip", bytes: Buffer.from(zip) };
}

/** Saved images across the project (the library of finished posts). */
export async function listSavedRenders(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "view");
  return db
    .select({ id: renders.id, postId: renders.postId, format: renders.format, createdAt: renders.createdAt, title: posts.title, passed: renders.passed })
    .from(renders)
    .innerJoin(posts, eq(posts.id, renders.postId))
    .where(and(eq(posts.projectId, projectId), eq(renders.saved, true)))
    .orderBy(desc(renders.createdAt))
    .limit(500);
}
