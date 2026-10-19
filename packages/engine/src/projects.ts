import { and, desc, eq, inArray } from "drizzle-orm";
import { type ProjectSettings, ProjectSettingsSchema, can, effectiveRole, type Role } from "@sme/core";
import { type DB, projectMembers, projects, posts, templates, designSystemVersions } from "@sme/db";
import { assertProject, assertWorkspace, type Actor, workspaceRole } from "./access";
import { EngineError, NotFound } from "./errors";

export async function createProject(db: DB, actor: Actor, input: { name: string; handle?: string }) {
  await assertWorkspace(db, actor, "project.create");
  const name = input.name.trim();
  if (!name) throw new EngineError("Give the project a name.");
  const [p] = await db
    .insert(projects)
    .values({ workspaceId: actor.workspaceId, name, handle: input.handle?.trim() ?? "", settings: ProjectSettingsSchema.parse({}) })
    .returning();
  return p;
}

export async function listProjects(db: DB, actor: Actor) {
  const ws = await workspaceRole(db, actor);
  if (!ws) return [];
  const rows = await db.select().from(projects).where(eq(projects.workspaceId, actor.workspaceId)).orderBy(desc(projects.createdAt));
  const overrides = rows.length
    ? await db.select().from(projectMembers).where(and(eq(projectMembers.userId, actor.userId), inArray(projectMembers.projectId, rows.map((r) => r.id))))
    : [];
  const out = [];
  for (const p of rows) {
    const role = effectiveRole(ws, (overrides.find((o) => o.projectId === p.id)?.role as Role) ?? null);
    if (!can(role, "view")) continue;
    const [ds] = p.currentDesignSystemVersionId
      ? await db.select({ name: designSystemVersions.name, version: designSystemVersions.version, tokens: designSystemVersions.tokens }).from(designSystemVersions).where(eq(designSystemVersions.id, p.currentDesignSystemVersionId))
      : [];
    const postCount = await db.$count(posts, eq(posts.projectId, p.id));
    const templateCount = await db.$count(templates, and(eq(templates.projectId, p.id), eq(templates.archived, false)));
    out.push({ ...p, role, designSystem: ds ? { name: ds.name, version: ds.version, tokens: ds.tokens } : null, postCount, templateCount });
  }
  return out;
}

export async function getProject(db: DB, actor: Actor, projectId: string) {
  const role = await assertProject(db, actor, projectId, "view");
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new NotFound("Project");
  return { ...p, settings: ProjectSettingsSchema.parse(p.settings ?? {}), role };
}

export async function updateProject(db: DB, actor: Actor, projectId: string, input: { name?: string; handle?: string; settings?: Partial<ProjectSettings> }) {
  await assertProject(db, actor, projectId, "project.manage");
  const current = await getProject(db, actor, projectId);
  const settings = input.settings
    ? ProjectSettingsSchema.parse({
        ...current.settings,
        ...input.settings,
        imagery: { ...current.settings.imagery, ...(input.settings.imagery ?? {}) },
        voice: { ...current.settings.voice, ...(input.settings.voice ?? {}) },
      })
    : current.settings;
  const [p] = await db
    .update(projects)
    .set({ name: input.name?.trim() || current.name, handle: input.handle ?? current.handle, settings })
    .where(eq(projects.id, projectId))
    .returning();
  return p;
}

export async function deleteProject(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "project.manage");
  await db.delete(projects).where(eq(projects.id, projectId));
}
