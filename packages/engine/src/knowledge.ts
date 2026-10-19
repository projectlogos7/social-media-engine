import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chunkText, crawlSite, type ExtractedPage } from "@sme/knowledge";
import { sha256 } from "@sme/core";
import { chunks, type DB, entities, enqueue, sources, webPages } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { EngineError, NotFound } from "./errors";
import { getRenderer } from "./runtime";

export type Source = typeof sources.$inferSelect;

export interface AutoDraft {
  templateId: string;
  entityTypes: string[];
  formats: string[];
  images: "generate" | "library" | "none";
}

export async function addSource(db: DB, actor: Actor, projectId: string, input: { url: string; maxPages?: number; pathPrefix?: string; renderJs?: boolean; intervalHours?: number; autoDraft?: AutoDraft | null }) {
  await assertProject(db, actor, projectId, "sources.manage");
  let url: URL;
  try {
    url = new URL(input.url.trim().match(/^https?:\/\//) ? input.url.trim() : `https://${input.url.trim()}`);
  } catch {
    throw new EngineError("Enter the website address, e.g. https://example.org");
  }
  const [s] = await db
    .insert(sources)
    .values({ projectId, url: url.toString(), maxPages: Math.min(Math.max(input.maxPages ?? 200, 1), 2000), pathPrefix: input.pathPrefix ?? "", renderJs: !!input.renderJs, intervalHours: Math.max(input.intervalHours ?? 24, 0), autoDraft: input.autoDraft ?? null, createdBy: actor.userId })
    .returning();
  return s;
}

export async function updateSource(db: DB, actor: Actor, sourceId: string, input: Partial<{ maxPages: number; pathPrefix: string; renderJs: boolean; intervalHours: number; autoDraft: AutoDraft | null }>) {
  const [s] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!s) throw new NotFound("Source");
  await assertProject(db, actor, s.projectId, "sources.manage");
  await db.update(sources).set(input).where(eq(sources.id, sourceId));
}

export async function listSources(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "view");
  const rows = await db.select().from(sources).where(eq(sources.projectId, projectId)).orderBy(desc(sources.createdAt));
  return Promise.all(rows.map(async (s) => ({ ...s, pageCount: await db.$count(webPages, eq(webPages.sourceId, s.id)) })));
}

export async function deleteSource(db: DB, actor: Actor, sourceId: string) {
  const [s] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!s) throw new NotFound("Source");
  await assertProject(db, actor, s.projectId, "sources.manage");
  await db.delete(sources).where(eq(sources.id, sourceId));
}

export async function requestCrawl(db: DB, actor: Actor, sourceId: string) {
  const [s] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!s) throw new NotFound("Source");
  await assertProject(db, actor, s.projectId, "sources.manage");
  await db.update(sources).set({ status: "queued" }).where(eq(sources.id, sourceId));
  return enqueue(db, "crawl", { sourceId, actor }, { projectId: s.projectId, createdBy: actor.userId, maxAttempts: 2 });
}

async function savePage(db: DB, source: Source, page: ExtractedPage): Promise<{ id: string; isNew: boolean; changed: boolean }> {
  const hash = sha256(`${page.title}\n${page.text}`);
  const [existing] = await db.select().from(webPages).where(and(eq(webPages.projectId, source.projectId), eq(webPages.url, page.canonical)));
  if (existing && existing.contentHash === hash) {
    await db.update(webPages).set({ lastSeenAt: new Date() }).where(eq(webPages.id, existing.id));
    return { id: existing.id, isNew: false, changed: false };
  }
  const values = {
    projectId: source.projectId,
    sourceId: source.id,
    url: page.canonical,
    title: page.title.slice(0, 500),
    description: page.description.slice(0, 2000),
    image: page.image ?? null,
    publishedAt: page.publishedAt ?? null,
    text: page.text.slice(0, 200_000),
    headings: page.headings,
    contentHash: hash,
    lastSeenAt: new Date(),
  };
  const id = existing
    ? (await db.update(webPages).set(values).where(eq(webPages.id, existing.id)).returning())[0].id
    : (await db.insert(webPages).values(values).returning())[0].id;
  await db.delete(chunks).where(eq(chunks.pageId, id));
  await db.delete(entities).where(eq(entities.pageId, id));
  const parts = chunkText([page.title, page.description, page.text].filter(Boolean).join("\n\n"));
  if (parts.length) await db.insert(chunks).values(parts.map((text, idx) => ({ projectId: source.projectId, pageId: id, idx, text })));
  if (page.entities.length)
    await db.insert(entities).values(
      page.entities.map((e) => ({ projectId: source.projectId, pageId: id, type: e.type, schemaType: e.schemaType, name: e.name.slice(0, 500), description: e.description?.slice(0, 4000) ?? null, url: e.url ?? null, image: e.image ?? null, date: e.date ?? null, data: e.data })),
    );
  return { id, isNew: !existing, changed: true };
}

/** Job body: crawls one source, stores pages/chunks/entities, and drafts posts for new content. */
export async function runCrawl(db: DB, sourceId: string, actor: Actor | null, progress: (m: string) => Promise<void> | void = () => {}) {
  const [source] = await db.select().from(sources).where(eq(sources.id, sourceId));
  if (!source) throw new NotFound("Source");
  const firstCrawl = !source.lastCrawledAt;
  await db.update(sources).set({ status: "crawling", lastError: null }).where(eq(sources.id, sourceId));
  const newPages: string[] = [];
  let saved = 0;
  try {
    const renderJs = source.renderJs
      ? async (url: string) => {
          const r = await getRenderer();
          return r.fetchRenderedHtml(url);
        }
      : undefined;
    const res = await crawlSite({
      startUrl: source.url,
      maxPages: source.maxPages,
      pathPrefix: source.pathPrefix,
      renderJs,
      onPage: async (page) => {
        const r = await savePage(db, source, page);
        saved++;
        if (r.isNew) newPages.push(r.id);
        if (saved % 5 === 0) await progress(`${saved} pages read`);
      },
    });
    await db.update(sources).set({ status: "idle", lastCrawledAt: new Date() }).where(eq(sources.id, sourceId));
    // New content → draft posts (not on the very first crawl, which would draft the whole site).
    const auto = source.autoDraft as AutoDraft | null;
    const drafted: string[] = [];
    if (auto && !firstCrawl && newPages.length && actor) {
      const ents = await db.select().from(entities).where(and(inArray(entities.pageId, newPages), inArray(entities.type, auto.entityTypes)));
      const pageIds = [...new Set(ents.map((e) => e.pageId))].slice(0, 20);
      for (const pid of pageIds) {
        const e = ents.find((x) => x.pageId === pid)!;
        const job = await enqueue(
          db,
          "generate",
          { actor, request: { projectId: source.projectId, templateId: auto.templateId, brief: `Announce this new ${e.type} from our website: "${e.name}".`, formats: auto.formats, variants: 1, sourcePageIds: [pid], images: auto.images } },
          { projectId: source.projectId, createdBy: actor.userId },
        );
        drafted.push(job.id);
      }
    }
    return { pages: res.pages.length, saved, newPages: newPages.length, skipped: res.skipped.length, sitemapUrls: res.sitemapUrls, draftJobs: drafted };
  } catch (e) {
    await db.update(sources).set({ status: "error", lastError: (e as Error).message }).where(eq(sources.id, sourceId));
    throw e;
  }
}

/** Full-text search over the project's website content. */
export async function searchKnowledge(db: DB, actor: Actor, projectId: string, query: string, limit = 20) {
  await assertProject(db, actor, projectId, "view");
  const q = query.trim();
  if (!q) return [];
  const rows = await db.execute<{ page_id: string; text: string; url: string; title: string; rank: number }>(sql`
    SELECT c.page_id, c.text, p.url, p.title, ts_rank(to_tsvector('simple', c.text), websearch_to_tsquery('simple', ${q})) AS rank
    FROM chunks c JOIN web_pages p ON p.id = c.page_id
    WHERE c.project_id = ${projectId} AND to_tsvector('simple', c.text) @@ websearch_to_tsquery('simple', ${q})
    ORDER BY rank DESC, c.idx ASC
    LIMIT ${limit}`);
  return (rows as unknown as { page_id: string; text: string; url: string; title: string; rank: number }[]).map((r) => ({ pageId: r.page_id, text: r.text, url: r.url, title: r.title, rank: Number(r.rank) }));
}

export async function listWebPages(db: DB, actor: Actor, projectId: string, opts: { q?: string; type?: string; limit?: number } = {}) {
  await assertProject(db, actor, projectId, "view");
  const conds = [eq(webPages.projectId, projectId)];
  if (opts.q) conds.push(sql`(${webPages.title} ILIKE ${`%${opts.q}%`} OR ${webPages.url} ILIKE ${`%${opts.q}%`})`);
  if (opts.type) conds.push(sql`EXISTS (SELECT 1 FROM entities e WHERE e.page_id = ${webPages.id} AND e.type = ${opts.type})`);
  const rows = await db
    .select({ id: webPages.id, url: webPages.url, title: webPages.title, description: webPages.description, image: webPages.image, publishedAt: webPages.publishedAt, firstSeenAt: webPages.firstSeenAt })
    .from(webPages)
    .where(and(...conds))
    .orderBy(desc(webPages.firstSeenAt))
    .limit(opts.limit ?? 200);
  const ents = rows.length ? await db.select({ pageId: entities.pageId, type: entities.type, name: entities.name, date: entities.date }).from(entities).where(inArray(entities.pageId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, entities: ents.filter((e) => e.pageId === r.id) }));
}

export async function getWebPage(db: DB, actor: Actor, pageId: string) {
  const [p] = await db.select().from(webPages).where(eq(webPages.id, pageId));
  if (!p) throw new NotFound("Page");
  await assertProject(db, actor, p.projectId, "view");
  const ents = await db.select().from(entities).where(eq(entities.pageId, pageId));
  return { ...p, entities: ents };
}

/** Sources whose interval has elapsed (for the scheduler). */
export async function dueSources(db: DB) {
  const rows = await db.execute<{ id: string; project_id: string; created_by: string | null; workspace_id: string }>(sql`
    SELECT s.id, s.project_id, s.created_by, p.workspace_id FROM sources s JOIN projects p ON p.id = s.project_id
    WHERE s.interval_hours > 0 AND s.status IN ('idle', 'error')
      AND (s.last_crawled_at IS NULL OR s.last_crawled_at < now() - make_interval(hours => s.interval_hours))`);
  return rows as unknown as { id: string; project_id: string; created_by: string | null; workspace_id: string }[];
}
