import { and, eq } from "drizzle-orm";
import { type Action, type Role, can, effectiveRole } from "@sme/core";
import { type DB, memberships, projectMembers, projects } from "@sme/db";
import { Forbidden, NotFound } from "./errors";

export interface Actor {
  userId: string;
  workspaceId: string;
}

export async function workspaceRole(db: DB, actor: Actor): Promise<Role | null> {
  const [m] = await db
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, actor.userId)));
  return (m?.role as Role) ?? null;
}

export async function assertWorkspace(db: DB, actor: Actor, action: Action): Promise<Role> {
  const role = await workspaceRole(db, actor);
  if (!can(role, action)) throw new Forbidden();
  return role!;
}

/** Effective role on a project: the workspace role, narrowed by a project-specific role if one is set. */
export async function projectRole(db: DB, actor: Actor, projectId: string): Promise<Role | null> {
  const [p] = await db.select({ ws: projects.workspaceId }).from(projects).where(eq(projects.id, projectId));
  if (!p || p.ws !== actor.workspaceId) return null;
  const ws = await workspaceRole(db, actor);
  if (!ws) return null;
  const [pm] = await db
    .select({ role: projectMembers.role })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, actor.userId)));
  return effectiveRole(ws, (pm?.role as Role) ?? null);
}

export async function assertProject(db: DB, actor: Actor, projectId: string, action: Action): Promise<Role> {
  const role = await projectRole(db, actor, projectId);
  if (!role) throw new NotFound("Project");
  if (!can(role, action)) throw new Forbidden();
  return role;
}
