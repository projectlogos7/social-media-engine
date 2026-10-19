import { can } from "@sme/core";
import { getDb } from "@sme/db";
import { getProject, listAssets, listMembers } from "@sme/engine";
import { IMAGE_PROVIDERS } from "@sme/generate";
import { requireSession } from "@/lib/session";
import { ProjectSettingsForm } from "@/components/project/ProjectSettings";
import { eq } from "drizzle-orm";
import { projectMembers } from "@sme/db";

export default async function ProjectSettingsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const s = await requireSession();
  const db = getDb();
  const [p, assets, members, overrides] = await Promise.all([
    getProject(db, s.actor, projectId),
    listAssets(db, s.actor, projectId, { approvedOnly: true }),
    listMembers(db, s.actor),
    db.select().from(projectMembers).where(eq(projectMembers.projectId, projectId)),
  ]);
  return (
    <ProjectSettingsForm
      projectId={projectId}
      canManage={can(p.role, "project.manage")}
      canMembers={can(s.role, "members.manage")}
      name={p.name}
      handle={p.handle}
      settings={p.settings}
      providers={Object.values(IMAGE_PROVIDERS).map((x) => ({ id: x.id, label: x.label, models: x.models, supportsSeed: x.supportsSeed, supportsReferences: x.supportsReferences }))}
      library={assets.map((a) => ({ id: a.id, name: a.name }))}
      members={members.members.map((m) => ({ userId: m.userId, name: m.name, email: m.email, role: m.role, projectRole: overrides.find((o) => o.userId === m.userId)?.role ?? null }))}
    />
  );
}
