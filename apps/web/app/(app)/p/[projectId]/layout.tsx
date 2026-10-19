import type { ReactNode } from "react";
import { getDb } from "@sme/db";
import { getProject } from "@sme/engine";
import { requireSession } from "@/lib/session";
import { ProjectTabs } from "@/components/project/ProjectTabs";

export default async function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const s = await requireSession();
  const p = await getProject(getDb(), s.actor, projectId);
  return (
    <div>
      <div className="row spread" style={{ marginBottom: 8 }}>
        <div>
          <div className="small muted">Project</div>
          <h1>{p.name} {p.handle && <span className="muted small">{p.handle}</span>}</h1>
        </div>
        <span className="badge">your role: {p.role}</span>
      </div>
      <ProjectTabs projectId={projectId} hasDs={!!p.currentDesignSystemVersionId} />
      {children}
    </div>
  );
}
