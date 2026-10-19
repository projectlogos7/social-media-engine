import { getDb } from "@sme/db";
import { getDsFile } from "@sme/engine";
import { fileResponse, route } from "@/lib/api";

export const GET = route<{ params: Promise<{ versionId: string }> }>(async (s, req, { params }) => {
  const { versionId } = await params;
  const path = new URL(req.url).searchParams.get("path") ?? "";
  const { file, bytes } = await getDsFile(getDb(), s.actor, versionId, path);
  return fileResponse(bytes, file.contentType, { immutable: true });
});
