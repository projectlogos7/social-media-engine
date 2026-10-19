import { and, eq, sql } from "drizzle-orm";
import type { DB } from "./client";
import { jobs } from "./schema";

export type Job = typeof jobs.$inferSelect;

export async function enqueue(
  db: DB,
  type: string,
  payload: Record<string, unknown>,
  opts: { runAt?: Date; projectId?: string | null; createdBy?: string | null; maxAttempts?: number } = {},
): Promise<Job> {
  const [job] = await db
    .insert(jobs)
    .values({ type, payload, runAt: opts.runAt ?? new Date(), projectId: opts.projectId ?? null, createdBy: opts.createdBy ?? null, maxAttempts: opts.maxAttempts ?? 3 })
    .returning();
  return job;
}

/** Claims the next due job (SKIP LOCKED, so several workers can share the queue). Stale locks (>15 min) are reclaimed. */
export async function claimNext(db: DB, types?: string[]): Promise<Job | null> {
  const typeFilter = types?.length ? sql`AND type IN (${sql.join(types.map((t) => sql`${t}`), sql`, `)})` : sql``;
  const rows = await db.execute<Job>(sql`
    UPDATE jobs SET status = 'running', locked_at = now(), attempts = attempts + 1, updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE ((status = 'queued' AND run_at <= now()) OR (status = 'running' AND locked_at < now() - interval '15 minutes'))
      ${typeFilter}
      ORDER BY run_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, type, payload, status, run_at AS "runAt", attempts, max_attempts AS "maxAttempts", locked_at AS "lockedAt", progress, error, result, project_id AS "projectId", created_by AS "createdBy", created_at AS "createdAt", updated_at AS "updatedAt"`);
  return (rows as unknown as Job[])[0] ?? null;
}

export async function setProgress(db: DB, id: string, progress: string) {
  await db.update(jobs).set({ progress, updatedAt: new Date() }).where(eq(jobs.id, id));
}

export async function complete(db: DB, id: string, result: unknown) {
  await db.update(jobs).set({ status: "done", result: result as object, error: null, lockedAt: null, updatedAt: new Date() }).where(eq(jobs.id, id));
}

/** Retries with exponential backoff until maxAttempts, then marks failed. */
export async function fail(db: DB, job: Job, error: string, retryable = true) {
  const again = retryable && job.attempts < job.maxAttempts;
  await db
    .update(jobs)
    .set({
      status: again ? "queued" : "failed",
      error,
      lockedAt: null,
      runAt: again ? new Date(Date.now() + 2 ** job.attempts * 15_000) : job.runAt,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, job.id)));
}
