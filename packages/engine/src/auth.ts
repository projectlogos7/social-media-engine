import { and, eq, gt, isNull } from "drizzle-orm";
import { ROLES, type Role, roleRank } from "@sme/core";
import { type DB, hashPassword, invites, memberships, projectMembers, randomToken, sessions, sha256Hex, users, verifyPassword, workspaces } from "@sme/db";
import { assertWorkspace, type Actor, workspaceRole } from "./access";
import { EngineError, Forbidden, NotFound } from "./errors";

const SESSION_DAYS = 30;

function cleanEmail(e: string): string {
  const email = e.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new EngineError("Enter a valid email address.");
  return email;
}

function checkPassword(pw: string) {
  if (pw.length < 10) throw new EngineError("Use a password of at least 10 characters.");
}

/** Creates a user and their own workspace (they become its owner). */
export async function signUp(db: DB, input: { email: string; name: string; password: string; workspaceName?: string }) {
  const email = cleanEmail(input.email);
  checkPassword(input.password);
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) throw new EngineError("An account with this email already exists. Sign in instead.");
  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ email, name: input.name.trim() || email.split("@")[0], passwordHash: await hashPassword(input.password) }).returning();
    const [ws] = await tx.insert(workspaces).values({ name: input.workspaceName?.trim() || `${user.name}'s workspace` }).returning();
    await tx.insert(memberships).values({ workspaceId: ws.id, userId: user.id, role: "owner" });
    return { user, workspace: ws };
  });
}

export async function signIn(db: DB, emailIn: string, password: string) {
  const email = cleanEmail(emailIn);
  const [user] = await db.select().from(users).where(eq(users.email, email));
  if (!user || !(await verifyPassword(password, user.passwordHash))) throw new EngineError("Email or password is incorrect.", 401);
  return user;
}

export async function createSession(db: DB, userId: string, workspaceId?: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  let ws = workspaceId;
  if (!ws) {
    const [m] = await db.select({ ws: memberships.workspaceId }).from(memberships).where(eq(memberships.userId, userId)).limit(1);
    ws = m?.ws;
  }
  await db.insert(sessions).values({ id: sha256Hex(token), userId, workspaceId: ws ?? null, expiresAt });
  return { token, expiresAt };
}

export interface SessionInfo {
  actor: Actor;
  user: { id: string; email: string; name: string };
  role: Role;
  workspace: { id: string; name: string };
  workspaces: { id: string; name: string; role: Role }[];
}

export async function getSession(db: DB, token: string | undefined | null): Promise<SessionInfo | null> {
  if (!token) return null;
  const [s] = await db
    .select({ userId: sessions.userId, workspaceId: sessions.workspaceId, email: users.email, name: users.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, sha256Hex(token)), gt(sessions.expiresAt, new Date())));
  if (!s) return null;
  const all = await db
    .select({ id: workspaces.id, name: workspaces.name, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, s.userId));
  if (!all.length) return null;
  const current = all.find((w) => w.id === s.workspaceId) ?? all[0];
  return {
    actor: { userId: s.userId, workspaceId: current.id },
    user: { id: s.userId, email: s.email, name: s.name },
    role: current.role as Role,
    workspace: { id: current.id, name: current.name },
    workspaces: all.map((w) => ({ ...w, role: w.role as Role })),
  };
}

export async function switchWorkspace(db: DB, token: string, workspaceId: string) {
  const [s] = await db.select().from(sessions).where(eq(sessions.id, sha256Hex(token)));
  if (!s) throw new Forbidden();
  const [m] = await db.select().from(memberships).where(and(eq(memberships.userId, s.userId), eq(memberships.workspaceId, workspaceId)));
  if (!m) throw new Forbidden();
  await db.update(sessions).set({ workspaceId }).where(eq(sessions.id, s.id));
}

export async function signOut(db: DB, token: string) {
  await db.delete(sessions).where(eq(sessions.id, sha256Hex(token)));
}

// Members and invites

export async function listMembers(db: DB, actor: Actor) {
  await assertWorkspace(db, actor, "view");
  const members = await db
    .select({ userId: users.id, email: users.email, name: users.name, role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, actor.workspaceId));
  const pending = await db
    .select({ id: invites.id, email: invites.email, role: invites.role, expiresAt: invites.expiresAt })
    .from(invites)
    .where(and(eq(invites.workspaceId, actor.workspaceId), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())));
  return { members, pending };
}

function assertAssignable(actorRole: Role, role: string): asserts role is Role {
  if (!ROLES.includes(role as Role)) throw new EngineError("Unknown role.");
  if (role === "owner" && actorRole !== "owner") throw new Forbidden("Only an owner can make someone an owner.");
  if (roleRank(role as Role) > roleRank(actorRole)) throw new Forbidden("You cannot grant a role above your own.");
}

/** Returns the invite link token (shown once). */
export async function createInvite(db: DB, actor: Actor, emailIn: string, role: string): Promise<{ token: string; expiresAt: Date }> {
  const actorRole = await assertWorkspace(db, actor, "members.manage");
  assertAssignable(actorRole, role);
  const email = cleanEmail(emailIn);
  const token = randomToken(24);
  const expiresAt = new Date(Date.now() + 7 * 86400_000);
  await db.insert(invites).values({ workspaceId: actor.workspaceId, email, role, tokenHash: sha256Hex(token), expiresAt, createdBy: actor.userId });
  return { token, expiresAt };
}

export async function revokeInvite(db: DB, actor: Actor, inviteId: string) {
  await assertWorkspace(db, actor, "members.manage");
  await db.delete(invites).where(and(eq(invites.id, inviteId), eq(invites.workspaceId, actor.workspaceId)));
}

export async function getInvite(db: DB, token: string) {
  const [inv] = await db
    .select({ id: invites.id, email: invites.email, role: invites.role, workspaceId: invites.workspaceId, workspaceName: workspaces.name, acceptedAt: invites.acceptedAt, expiresAt: invites.expiresAt })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .where(eq(invites.tokenHash, sha256Hex(token)));
  if (!inv || inv.acceptedAt || inv.expiresAt < new Date()) return null;
  return inv;
}

/** Accepts an invite: creates the account if needed (password required then), joins the workspace. */
export async function acceptInvite(db: DB, token: string, input: { name?: string; password?: string; existingUserId?: string }) {
  const inv = await getInvite(db, token);
  if (!inv) throw new EngineError("This invite link is invalid or has expired.");
  let userId = input.existingUserId;
  if (!userId) {
    const [existing] = await db.select().from(users).where(eq(users.email, inv.email));
    if (existing) {
      if (!input.password || !(await verifyPassword(input.password, existing.passwordHash))) throw new EngineError("This email already has an account; enter its password to join.", 401);
      userId = existing.id;
    } else {
      checkPassword(input.password ?? "");
      const [u] = await db.insert(users).values({ email: inv.email, name: input.name?.trim() || inv.email.split("@")[0], passwordHash: await hashPassword(input.password!) }).returning();
      userId = u.id;
    }
  }
  await db
    .insert(memberships)
    .values({ workspaceId: inv.workspaceId, userId, role: inv.role })
    .onConflictDoUpdate({ target: [memberships.workspaceId, memberships.userId], set: { role: inv.role } });
  await db.update(invites).set({ acceptedAt: new Date() }).where(eq(invites.id, inv.id));
  return { userId, workspaceId: inv.workspaceId };
}

export async function setMemberRole(db: DB, actor: Actor, userId: string, role: string) {
  const actorRole = await assertWorkspace(db, actor, "members.manage");
  assertAssignable(actorRole, role);
  const target = await workspaceRole(db, { userId, workspaceId: actor.workspaceId });
  if (!target) throw new NotFound("Member");
  if (roleRank(target) > roleRank(actorRole)) throw new Forbidden("You cannot change the role of someone above you.");
  if (target === "owner" && role !== "owner") {
    const owners = await db.select().from(memberships).where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.role, "owner")));
    if (owners.length <= 1) throw new EngineError("A workspace needs at least one owner.");
  }
  await db.update(memberships).set({ role }).where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, userId)));
}

export async function removeMember(db: DB, actor: Actor, userId: string) {
  await setMemberRole(db, actor, userId, "viewer"); // runs the same permission checks
  await db.delete(memberships).where(and(eq(memberships.workspaceId, actor.workspaceId), eq(memberships.userId, userId)));
}

/** Narrows a member's role on one project (or clears it with null). */
export async function setProjectRole(db: DB, actor: Actor, projectId: string, userId: string, role: string | null) {
  await assertWorkspace(db, actor, "members.manage");
  if (role === null) {
    await db.delete(projectMembers).where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
    return;
  }
  if (!ROLES.includes(role as Role)) throw new EngineError("Unknown role.");
  await db.insert(projectMembers).values({ projectId, userId, role }).onConflictDoUpdate({ target: [projectMembers.projectId, projectMembers.userId], set: { role } });
}
