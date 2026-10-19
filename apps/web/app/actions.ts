"use server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { FormatId, ProjectSettings, SlotValues } from "@sme/core";
import { getDb } from "@sme/db";
import * as E from "@sme/engine";
import { COOKIE, currentSession, setSessionCookie } from "@/lib/session";
import type { Result } from "@/lib/result";

const db = () => getDb();

async function act<T>(fn: (s: E.SessionInfo) => Promise<T>, revalidate?: string): Promise<Result<T>> {
  const s = await currentSession();
  if (!s) return { ok: false, error: "Your session ended. Sign in again." };
  try {
    const data = await fn(s);
    if (revalidate) revalidatePath(revalidate, "layout");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof E.EngineError) return { ok: false, error: e.message, details: e.details };
    console.error(e);
    return { ok: false, error: (e as Error).message || "Something went wrong." };
  }
}

// ---- auth

export async function signUpAction(_: unknown, form: FormData): Promise<Result | undefined> {
  try {
    const { user, workspace } = await E.signUp(db(), {
      email: String(form.get("email") ?? ""),
      name: String(form.get("name") ?? ""),
      password: String(form.get("password") ?? ""),
      workspaceName: String(form.get("workspace") ?? ""),
    });
    const s = await E.createSession(db(), user.id, workspace.id);
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect("/");
}

export async function signInAction(_: unknown, form: FormData): Promise<Result | undefined> {
  try {
    const user = await E.signIn(db(), String(form.get("email") ?? ""), String(form.get("password") ?? ""));
    const s = await E.createSession(db(), user.id);
    await setSessionCookie(s.token, s.expiresAt);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect(String(form.get("next") || "/"));
}

export async function signOutAction() {
  const jar = await cookies();
  const t = jar.get(COOKIE)?.value;
  if (t) await E.signOut(db(), t);
  jar.delete(COOKIE);
  redirect("/login");
}

export async function acceptInviteAction(_: unknown, form: FormData): Promise<Result | undefined> {
  try {
    const s = await currentSession();
    const token = String(form.get("token"));
    const inv = await E.getInvite(db(), token);
    const existingUserId = s && inv && s.user.email === inv.email ? s.user.id : undefined;
    const r = await E.acceptInvite(db(), token, { name: String(form.get("name") ?? ""), password: String(form.get("password") ?? ""), existingUserId });
    const sess = await E.createSession(db(), r.userId, r.workspaceId);
    await setSessionCookie(sess.token, sess.expiresAt);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  redirect("/");
}

export async function switchWorkspaceAction(workspaceId: string) {
  const t = (await cookies()).get(COOKIE)?.value;
  if (t) await E.switchWorkspace(db(), t, workspaceId);
  redirect("/");
}

// ---- workspace

export const inviteMember = async (email: string, role: string) => act((s) => E.createInvite(db(), s.actor, email, role), "/settings");
export const revokeInvite = async (id: string) => act((s) => E.revokeInvite(db(), s.actor, id), "/settings");
export const setMemberRole = async (userId: string, role: string) => act((s) => E.setMemberRole(db(), s.actor, userId, role), "/settings");
export const removeMember = async (userId: string) => act((s) => E.removeMember(db(), s.actor, userId), "/settings");
export const setProviderKey = async (provider: string, key: string) => act((s) => E.setProviderKey(db(), s.actor, provider, key), "/settings");
export const setProjectRole = async (projectId: string, userId: string, role: string | null) => act((s) => E.setProjectRole(db(), s.actor, projectId, userId, role), `/p/${projectId}`);

// ---- projects

export async function createProjectAction(name: string, handle: string) {
  const r = await act((s) => E.createProject(db(), s.actor, { name, handle }));
  if (r.ok) redirect(`/p/${r.data.id}/design`);
  return r;
}
export const updateProject = async (projectId: string, input: { name?: string; handle?: string; settings?: Partial<ProjectSettings> }) =>
  act((s) => E.updateProject(db(), s.actor, projectId, input), `/p/${projectId}`);
export async function deleteProjectAction(projectId: string) {
  const r = await act((s) => E.deleteProject(db(), s.actor, projectId));
  if (r.ok) redirect("/");
  return r;
}

// ---- design systems

export const publishDsVersion = async (projectId: string, versionId: string) => act((s) => E.publishDesignSystemVersion(db(), s.actor, versionId), `/p/${projectId}`);
export const deleteDsVersion = async (projectId: string, versionId: string) => act((s) => E.deleteDraftVersion(db(), s.actor, versionId), `/p/${projectId}`);
export const startComparison = async (projectId: string, versionId: string, postIds: string[]) =>
  act(async (s) => (await E.startComparison(db(), s.actor, projectId, versionId, postIds)).id);
export const applyCurrentDs = async (projectId: string, postIds: string[]) => act((s) => E.applyCurrentDesignSystem(db(), s.actor, postIds), `/p/${projectId}`);

// ---- templates

export const saveTemplate = async (projectId: string, spec: unknown, templateId?: string, note?: string) =>
  act(async (s) => {
    const r = await E.saveTemplate(db(), s.actor, projectId, spec, { templateId, note });
    return { templateId: r.templateId, versionId: r.version.id, version: r.version.version, warnings: r.warnings };
  }, `/p/${projectId}/templates`);
export const setGolden = async (projectId: string, versionId: string) => act((s) => E.setGolden(db(), s.actor, versionId), `/p/${projectId}/templates`);
export const archiveTemplate = async (projectId: string, templateId: string, archived: boolean) => act((s) => E.setTemplateArchived(db(), s.actor, templateId, archived), `/p/${projectId}/templates`);
export const templateFromComponent = async (projectId: string, component: string, format: FormatId) =>
  act(async (s) => (await E.createTemplateFromComponent(db(), s.actor, projectId, component, format)).templateId, `/p/${projectId}/templates`);
export const createStarterKit = async (projectId: string, choice: Parameters<typeof E.createStarterKit>[3]) =>
  act(async (s) => (await E.createStarterKit(db(), s.actor, projectId, choice)).length, `/p/${projectId}/templates`);

// ---- posts

export const createPost = async (projectId: string, input: E.NewPost) => act(async (s) => (await E.createPost(db(), s.actor, projectId, input)).id, `/p/${projectId}`);
export const updatePost = async (projectId: string, postId: string, u: E.PostUpdate) => act((s) => E.updatePost(db(), s.actor, postId, u), `/p/${projectId}/posts/${postId}`);
export const renderPost = async (projectId: string, postId: string) =>
  act(async (s) => (await E.renderPost(db(), s.actor, postId)).map((r) => ({ id: r.id, passed: r.passed })), `/p/${projectId}/posts/${postId}`);
export const deletePost = async (projectId: string, postId: string) => act((s) => E.deletePost(db(), s.actor, postId), `/p/${projectId}`);
export const duplicatePost = async (projectId: string, postId: string) => act(async (s) => (await E.duplicatePost(db(), s.actor, postId)).id, `/p/${projectId}`);
export const chooseImage = async (projectId: string, postId: string, pageId: string, slot: string, assetId: string) =>
  act(async (s) => (await E.chooseImage(db(), s.actor, postId, pageId, slot, assetId)).length, `/p/${projectId}/posts/${postId}`);
export const startGeneration = async (req: E.GenerateRequest) => act(async (s) => (await E.startGeneration(db(), s.actor, req)).id);
export const createBatch = async (req: E.BatchRequest) => act((s) => E.createBatch(db(), s.actor, req));

// ---- library

export const setAssetApproved = async (projectId: string, assetId: string, approved: boolean) => act((s) => E.setAssetApproved(db(), s.actor, assetId, approved), `/p/${projectId}/library`);
export const deleteAsset = async (projectId: string, assetId: string) => act((s) => E.deleteAsset(db(), s.actor, assetId), `/p/${projectId}/library`);

// ---- website

export const addSource = async (projectId: string, input: Parameters<typeof E.addSource>[3]) =>
  act(async (s) => {
    const src = await E.addSource(db(), s.actor, projectId, input);
    await E.requestCrawl(db(), s.actor, src.id);
    return src.id;
  }, `/p/${projectId}/website`);
export const updateSource = async (projectId: string, sourceId: string, input: Parameters<typeof E.updateSource>[3]) => act((s) => E.updateSource(db(), s.actor, sourceId, input), `/p/${projectId}/website`);
export const crawlNow = async (projectId: string, sourceId: string) => act(async (s) => (await E.requestCrawl(db(), s.actor, sourceId)).id, `/p/${projectId}/website`);
export const deleteSource = async (projectId: string, sourceId: string) => act((s) => E.deleteSource(db(), s.actor, sourceId), `/p/${projectId}/website`);
export const searchKnowledge = async (projectId: string, q: string) => act((s) => E.searchKnowledge(db(), s.actor, projectId, q, 15));

// ---- publishing

export const schedulePublication = async (projectId: string, postId: string, channelId: string, format: FormatId, at?: string) =>
  act(async (s) => (await E.schedulePublication(db(), s.actor, postId, channelId, format, at ? new Date(at) : undefined)).id, `/p/${projectId}`);
export const cancelPublication = async (projectId: string, id: string) => act((s) => E.cancelPublication(db(), s.actor, id), `/p/${projectId}`);
export const deleteChannel = async (projectId: string, id: string) => act((s) => E.deleteChannel(db(), s.actor, id), `/p/${projectId}/publish`);

export type SlotValuesT = SlotValues;
