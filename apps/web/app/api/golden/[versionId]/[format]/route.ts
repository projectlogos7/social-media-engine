import { eq } from "drizzle-orm";
import { getDb, getStorage, templateVersions, templates } from "@sme/db";
import { assertProject } from "@sme/engine";
import { fileResponse, route } from "@/lib/api";

export const GET = route<{ params: Promise<{ versionId: string; format: string }> }>(async (s, _req, { params }) => {
  const { versionId, format } = await params;
  const [row] = await getDb().select({ golden: templateVersions.golden, projectId: templates.projectId }).from(templateVersions).innerJoin(templates, eq(templates.id, templateVersions.templateId)).where(eq(templateVersions.id, versionId));
  if (!row) return new Response("Not found", { status: 404 });
  await assertProject(getDb(), s.actor, row.projectId, "view");
  const key = (row.golden as Record<string, string>)[format];
  if (!key) return new Response("No snapshot", { status: 404 });
  return fileResponse(await getStorage().get(key), "image/png", { immutable: true });
});
