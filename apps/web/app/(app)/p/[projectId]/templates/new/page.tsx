import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { BLANK_TEMPLATE, dsSummary } from "@/lib/ds";
import { NewTemplate } from "@/components/project/TemplateBits";
import { TemplateEditor } from "@/components/project/TemplateEditor";

export default async function NewTemplatePage({ params, searchParams }: { params: Promise<{ projectId: string }>; searchParams: Promise<{ blank?: string }> }) {
  const { projectId } = await params;
  const { blank } = await searchParams;
  const s = await requireSession();
  const ds = await dsSummary(s.actor, projectId);
  if (!ds) notFound();
  if (blank) return <TemplateEditor projectId={projectId} ds={ds} initial={BLANK_TEMPLATE} canEdit />;
  return <NewTemplate projectId={projectId} ds={ds} />;
}
