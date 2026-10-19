import type { FormatId } from "@sme/core";
import { getDb } from "@sme/db";
import { exportPost } from "@sme/engine";
import { fileResponse, route } from "@/lib/api";

export const GET = route<{ params: Promise<{ id: string }> }>(async (s, req, { params }) => {
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const kind = (q.get("kind") ?? "png") as "png" | "zip" | "pdf";
  const file = await exportPost(getDb(), s.actor, id, q.get("format") as FormatId, kind, q.get("force") === "1");
  return fileResponse(file.bytes, file.contentType, { filename: file.filename });
});
