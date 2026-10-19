import { desc, eq, inArray } from "drizzle-orm";
import type { FormatId } from "@sme/core";
import { visualDiff } from "@sme/render";
import { type DB, designSystemVersions, getStorage, posts } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { EngineError } from "./errors";
import { renderPostInternal, updatePost } from "./posts";

/**
 * Renders posts with another design-system version without changing them and
 * reports the visual difference and quality result per page and format.
 */
export async function compareDesignSystem(db: DB, actor: Actor, projectId: string, versionId: string, postIds: string[]) {
  await assertProject(db, actor, projectId, "post.create");
  const [v] = await db.select().from(designSystemVersions).where(eq(designSystemVersions.id, versionId));
  if (!v || v.projectId !== projectId) throw new EngineError("That design-system version does not belong to this project.");
  const rows = await db.select().from(posts).where(inArray(posts.id, postIds));
  const storage = getStorage();
  const out = [];
  for (const post of rows.filter((p) => p.projectId === projectId)) {
    const before = await renderPostInternal(db, post.id, { createdBy: actor.userId });
    const after = await renderPostInternal(db, post.id, { designSystemVersionId: versionId, createdBy: actor.userId });
    for (const b of before) {
      const a = after.find((x) => x.pageId === b.pageId && x.format === b.format);
      if (!a) continue;
      const d = visualDiff(await storage.get(b.storageKey), await storage.get(a.storageKey));
      out.push({ postId: post.id, title: post.title, pageId: b.pageId, format: b.format as FormatId, beforeRenderId: b.id, afterRenderId: a.id, diffRatio: +d.ratio.toFixed(4), passedBefore: b.passed, passedAfter: a.passed });
    }
  }
  return out;
}

/** Moves posts to the project's current design system (after reviewing the comparison). */
export async function applyCurrentDesignSystem(db: DB, actor: Actor, postIds: string[]) {
  for (const id of postIds) await updatePost(db, actor, id, { upgradeDesignSystem: true });
}

export async function postsUsingOlderDesignSystem(db: DB, actor: Actor, projectId: string, currentVersionId: string) {
  await assertProject(db, actor, projectId, "view");
  const rows = await db.select({ id: posts.id, title: posts.title, ds: posts.designSystemVersionId, status: posts.status }).from(posts).where(eq(posts.projectId, projectId)).orderBy(desc(posts.createdAt));
  return rows.filter((r) => r.ds !== currentVersionId);
}

