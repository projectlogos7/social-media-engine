import { getDb } from "@sme/db";
import { listTemplates, listWebPages } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { BatchForm } from "@/components/project/Batch";

export default async function BatchPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const s = await requireSession();
  const [templates, pages] = await Promise.all([listTemplates(getDb(), s.actor, projectId), listWebPages(getDb(), s.actor, projectId, { limit: 300 })]);
  return (
    <BatchForm
      projectId={projectId}
      templates={templates.filter((t) => t.spec?.role === "single").map((t) => ({ id: t.id, name: t.name, formats: t.spec!.formats }))}
      pages={pages.map((p) => ({ id: p.id, title: p.title, url: p.url, types: [...new Set(p.entities.map((e) => e.type))], firstSeenAt: p.firstSeenAt.toISOString() }))}
    />
  );
}
