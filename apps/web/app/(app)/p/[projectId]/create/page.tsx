import { getDb } from "@sme/db";
import { listAssets, listTemplates, listWebPages, getProject } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { Composer } from "@/components/project/Composer";

export default async function CreatePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ page?: string; template?: string }> }) {
  const { projectId } = await params;
  const sp = await searchParams;
  const s = await requireSession();
  const db = getDb();
  const [project, templates, assets, pages] = await Promise.all([
    getProject(db, s.actor, projectId),
    listTemplates(db, s.actor, projectId),
    listAssets(db, s.actor, projectId, { approvedOnly: true }),
    listWebPages(db, s.actor, projectId, { limit: 300 }),
  ]);
  return (
    <Composer
      projectId={projectId}
      imagery={{ provider: project.settings.imagery.provider, candidates: project.settings.imagery.candidates }}
      templates={templates.filter((t) => t.spec && t.versionId).map((t) => ({ id: t.id, versionId: t.versionId!, name: t.name, role: t.spec!.role, spec: t.spec! }))}
      library={assets.map((a) => ({ id: a.id, name: a.name, kind: a.kind }))}
      pages={pages.map((p) => ({ id: p.id, title: p.title, url: p.url, types: [...new Set(p.entities.map((e) => e.type))] }))}
      initialPageId={sp.page}
      initialTemplateId={sp.template}
    />
  );
}
