import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, getTemplate } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { dsSummary } from "@/lib/ds";
import { TemplateEditor } from "@/components/project/TemplateEditor";

export default async function TemplatePage({ params }: { params: Promise<{ projectId: string; templateId: string }> }) {
  const { projectId, templateId } = await params;
  const s = await requireSession();
  const [p, t, ds] = await Promise.all([getProject(getDb(), s.actor, projectId), getTemplate(getDb(), s.actor, templateId), dsSummary(s.actor, projectId)]);
  return (
    <TemplateEditor
      projectId={projectId}
      ds={ds!}
      templateId={templateId}
      initial={t.current.spec}
      current={{ versionId: t.current.id, version: t.current.version, golden: Object.keys(t.current.golden as Record<string, string>) }}
      versions={t.versions.map((v) => ({ id: v.id, version: v.version, note: v.note, createdAt: v.createdAt.toISOString() }))}
      canEdit={can(p.role, "template.manage")}
    />
  );
}
