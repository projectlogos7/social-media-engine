import { randomUUID } from "node:crypto";
import type { FormatId } from "@sme/core";
import { type DB, enqueue } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { EngineError } from "./errors";

export interface BatchRequest {
  projectId: string;
  templateIds: string[];
  sourcePageIds: string[];
  /** Brief applied to every post; "{title}" is replaced by the page title. */
  brief: string;
  formats: FormatId[];
  images: "generate" | "library" | "none";
}

/** One generation job per (website page × template); posts share a batch id. */
export async function createBatch(db: DB, actor: Actor, req: BatchRequest) {
  await assertProject(db, actor, req.projectId, "post.create");
  if (!req.templateIds.length) throw new EngineError("Choose at least one template.");
  const pages = req.sourcePageIds.length ? req.sourcePageIds : [null];
  if (pages.length * req.templateIds.length > 60) throw new EngineError("A batch can create at most 60 posts.");
  const batchId = randomUUID();
  const jobIds: string[] = [];
  for (const pageId of pages)
    for (const templateId of req.templateIds) {
      const job = await enqueue(
        db,
        "generate",
        { actor, request: { projectId: req.projectId, templateId, brief: req.brief, formats: req.formats, variants: 1, sourcePageIds: pageId ? [pageId] : [], images: req.images, batchId } },
        { projectId: req.projectId, createdBy: actor.userId },
      );
      jobIds.push(job.id);
    }
  return { batchId, jobIds };
}
