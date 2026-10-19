import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, listSources, listTemplates, listWebPages } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { Sources, WebPages } from "@/components/project/Website";

export default async function WebsitePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ q?: string; type?: string }> }) {
  const { projectId } = await params;
  const { q, type } = await searchParams;
  const s = await requireSession();
  const db = getDb();
  const [p, sources, pages, templates] = await Promise.all([getProject(db, s.actor, projectId), listSources(db, s.actor, projectId), listWebPages(db, s.actor, projectId, { q, type, limit: 200 }), listTemplates(db, s.actor, projectId)]);
  return (
    <div className="stack">
      <Sources
        projectId={projectId}
        canManage={can(p.role, "sources.manage")}
        templates={templates.filter((t) => t.spec?.role === "single").map((t) => ({ id: t.id, name: t.name, formats: t.spec!.formats }))}
        sources={sources.map((x) => ({ id: x.id, url: x.url, status: x.status, lastError: x.lastError, lastCrawledAt: x.lastCrawledAt?.toISOString() ?? null, pageCount: x.pageCount, maxPages: x.maxPages, intervalHours: x.intervalHours, renderJs: x.renderJs, pathPrefix: x.pathPrefix, autoDraft: x.autoDraft as never }))}
      />
      <WebPages projectId={projectId} q={q ?? ""} type={type ?? ""} pages={pages.map((x) => ({ id: x.id, url: x.url, title: x.title, description: x.description, image: x.image, firstSeenAt: x.firstSeenAt.toISOString(), entities: x.entities }))} />
    </div>
  );
}
