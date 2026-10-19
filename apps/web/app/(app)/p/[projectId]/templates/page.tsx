import Link from "next/link";
import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, listTemplates } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { dsSummary } from "@/lib/ds";
import { TemplateCardActions } from "@/components/project/TemplateBits";

export default async function TemplatesPage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ archived?: string }> }) {
  const { projectId } = await params;
  const { archived } = await searchParams;
  const s = await requireSession();
  const [p, list, ds] = await Promise.all([getProject(getDb(), s.actor, projectId), listTemplates(getDb(), s.actor, projectId, { includeArchived: !!archived }), dsSummary(s.actor, projectId)]);
  const manage = can(p.role, "template.manage");
  return (
    <div className="stack">
      <div className="row spread">
        <p className="muted" style={{ margin: 0 }}>Templates fix the layout, type and colours. Every edit is a new version; posts keep the version they were made with.</p>
        <div className="row">
          <Link href={`/p/${projectId}/templates${archived ? "" : "?archived=1"}`} className="btn">{archived ? "Hide archived" : "Show archived"}</Link>
          {manage && ds && <Link href={`/p/${projectId}/templates/new`} className="btn primary">New template</Link>}
        </div>
      </div>
      <div className="grid">
        {list.map((t) => (
          <div key={t.id} className="card" style={{ padding: 10, opacity: t.archived ? 0.6 : 1 }}>
            <Link href={`/p/${projectId}/templates/${t.id}`}>
              {t.versionId && t.spec ? <img className="thumb" src={`/api/golden/${t.versionId}/${t.spec.formats[0]}`} alt="" loading="lazy" /> : <div className="thumb" />}
            </Link>
            <div style={{ marginTop: 8, fontWeight: 600 }}>{t.name}</div>
            <div className="small muted">v{t.version} · {t.role} · {t.spec?.formats.join(", ")}</div>
            {manage && <TemplateCardActions projectId={projectId} templateId={t.id} archived={t.archived} />}
          </div>
        ))}
      </div>
      {!list.length && <div className="card muted">No templates yet.{ds ? " Start from a showcase in your design system, the starter kit, or a blank template." : " Publish a design system first."}</div>}
    </div>
  );
}
