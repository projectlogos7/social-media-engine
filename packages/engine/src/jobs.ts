import { desc, eq, sql } from "drizzle-orm";
import { claimNext, complete, type DB, enqueue, fail, type Job, jobs, setProgress } from "@sme/db";
import { PublishError } from "@sme/publish";
import { RefusalError } from "@sme/generate";
import { assertProject, type Actor } from "./access";
import { EngineError, NotFound } from "./errors";
import { generatePosts, type GenerateDeps, type GenerateRequest } from "./generation";
import { dueSources, runCrawl } from "./knowledge";
import { runPublication } from "./publishing";
import { compareDesignSystem } from "./rerender";

type Handler = (db: DB, job: Job, progress: (m: string) => Promise<void>) => Promise<unknown>;

export const testHooks: { generateDeps?: GenerateDeps } = {};

const HANDLERS: Record<string, Handler> = {
  generate: async (db, job, progress) => {
    const { actor, request } = job.payload as { actor: Actor; request: GenerateRequest };
    return generatePosts(db, actor, { ...request, runId: request.runId ?? job.id }, { ...testHooks.generateDeps, progress });
  },
  crawl: async (db, job, progress) => {
    const { sourceId, actor } = job.payload as { sourceId: string; actor: Actor | null };
    return runCrawl(db, sourceId, actor, progress);
  },
  publish: async (db, job) => runPublication(db, (job.payload as { publicationId: string }).publicationId),
  compare: async (db, job) => {
    const { actor, projectId, versionId, postIds } = job.payload as { actor: Actor; projectId: string; versionId: string; postIds: string[] };
    return compareDesignSystem(db, actor, projectId, versionId, postIds);
  },
};

/** Errors that will not get better by retrying. */
function retryable(e: unknown): boolean {
  if (e instanceof RefusalError) return false;
  if (e instanceof PublishError) return e.retryable;
  if (e instanceof EngineError) return false;
  return true;
}

/** Runs one job if one is due. Returns false when the queue is empty. */
export async function runOneJob(db: DB): Promise<boolean> {
  const job = await claimNext(db, Object.keys(HANDLERS));
  if (!job) return false;
  const handler = HANDLERS[job.type];
  try {
    const result = await handler(db, job, (m) => setProgress(db, job.id, m));
    await complete(db, job.id, result ?? null);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    console.error(`[job ${job.type} ${job.id}]`, msg);
    await fail(db, job, msg, retryable(e));
  }
  return true;
}

/** Queues crawls for sources whose interval has elapsed. */
export async function scheduleDueCrawls(db: DB) {
  for (const s of await dueSources(db)) {
    const already = (await db.execute(sql`SELECT id FROM jobs WHERE type = 'crawl' AND status IN ('queued','running') AND payload->>'sourceId' = ${s.id} LIMIT 1`)) as unknown as { id: string }[];
    if (already.length) continue;
    const actor = s.created_by ? { userId: s.created_by, workspaceId: s.workspace_id } : null;
    await enqueue(db, "crawl", { sourceId: s.id, actor }, { projectId: s.project_id, maxAttempts: 2 });
  }
}

/** The worker loop: drains the queue, checks schedules every minute. */
export async function runWorker(db: DB, opts: { concurrency?: number; signal?: AbortSignal } = {}) {
  let lastSchedule = 0;
  const loop = async () => {
    while (!opts.signal?.aborted) {
      if (Date.now() - lastSchedule > 60_000) {
        lastSchedule = Date.now();
        await scheduleDueCrawls(db).catch((e) => console.error("[scheduler]", e));
      }
      const worked = await runOneJob(db).catch((e) => {
        console.error("[worker]", e);
        return false;
      });
      if (!worked) await new Promise((r) => setTimeout(r, 1000));
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 2 }, loop));
}

export async function startGeneration(db: DB, actor: Actor, request: GenerateRequest) {
  await assertProject(db, actor, request.projectId, "post.create");
  return enqueue(db, "generate", { actor, request }, { projectId: request.projectId, createdBy: actor.userId, maxAttempts: 2 });
}

export async function startComparison(db: DB, actor: Actor, projectId: string, versionId: string, postIds: string[]) {
  await assertProject(db, actor, projectId, "post.create");
  return enqueue(db, "compare", { actor, projectId, versionId, postIds }, { projectId, createdBy: actor.userId, maxAttempts: 1 });
}

export async function getJob(db: DB, actor: Actor, jobId: string) {
  const [j] = await db.select().from(jobs).where(eq(jobs.id, jobId));
  if (!j || !j.projectId) throw new NotFound("Job");
  await assertProject(db, actor, j.projectId, "view");
  const { payload: _p, ...rest } = j;
  return rest;
}

export async function listJobs(db: DB, actor: Actor, projectId: string, limit = 50) {
  await assertProject(db, actor, projectId, "view");
  const rows = await db.select().from(jobs).where(eq(jobs.projectId, projectId)).orderBy(desc(jobs.createdAt)).limit(limit);
  return rows.map(({ payload, ...j }) => ({ ...j, summary: summarize(j.type, payload as Record<string, unknown>) }));
}

function summarize(type: string, payload: Record<string, unknown>): string {
  const req = payload.request as GenerateRequest | undefined;
  if (type === "generate" && req) return req.brief.slice(0, 120) || "Generate posts";
  if (type === "crawl") return "Read website";
  if (type === "publish") return "Publish";
  if (type === "compare") return "Compare design-system versions";
  return type;
}
