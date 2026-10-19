import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { FORMATS, type FormatId, PLATFORM_FORMATS, type Platform } from "@sme/core";
import { igAuthUrl, igExchangeCode, igPublish, liAuthUrl, liExchangeCode, liPublish, PublishError } from "@sme/publish";
import { channels, type DB, decrypt, encrypt, enqueue, getStorage, jobs, oauthStates, postPages, posts, publications, randomToken, renders, sign } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { EngineError, NotFound } from "./errors";
import { captionText, renderPostInternal } from "./posts";
import { getRenderer } from "./runtime";

export function appUrl(): string {
  return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

function igApp() {
  if (!process.env.META_APP_ID || !process.env.META_APP_SECRET) return null;
  return { appId: process.env.META_APP_ID, appSecret: process.env.META_APP_SECRET, redirectUri: `${appUrl()}/api/oauth/instagram/callback` };
}
function liApp() {
  if (!process.env.LINKEDIN_CLIENT_ID || !process.env.LINKEDIN_CLIENT_SECRET) return null;
  return { clientId: process.env.LINKEDIN_CLIENT_ID, clientSecret: process.env.LINKEDIN_CLIENT_SECRET, redirectUri: `${appUrl()}/api/oauth/linkedin/callback` };
}

export function publishingAvailability() {
  return { instagram: !!igApp(), linkedin: !!liApp() };
}

export async function startConnect(db: DB, actor: Actor, projectId: string, platform: Platform): Promise<string> {
  await assertProject(db, actor, projectId, "channels.manage");
  const state = randomToken(24);
  await db.insert(oauthStates).values({ state, projectId, platform, userId: actor.userId });
  if (platform === "instagram") {
    const app = igApp();
    if (!app) throw new EngineError("Instagram publishing is not configured on this server (META_APP_ID / META_APP_SECRET).");
    return igAuthUrl(app, state);
  }
  if (platform === "linkedin") {
    const app = liApp();
    if (!app) throw new EngineError("LinkedIn publishing is not configured on this server (LINKEDIN_CLIENT_ID / LINKEDIN_CLIENT_SECRET).");
    return liAuthUrl(app, state);
  }
  throw new EngineError("Unsupported platform.");
}

/** OAuth callback: stores one channel per Instagram account / LinkedIn author the user can post as. */
export async function finishConnect(db: DB, actor: Actor, platform: Platform, state: string, code: string) {
  const [st] = await db.select().from(oauthStates).where(eq(oauthStates.state, state));
  await db.delete(oauthStates).where(eq(oauthStates.state, state));
  if (!st || st.platform !== platform || st.userId !== actor.userId || Date.now() - st.createdAt.getTime() > 15 * 60_000) throw new EngineError("This sign-in link expired. Try connecting again.");
  await assertProject(db, actor, st.projectId, "channels.manage");
  const created: string[] = [];
  if (platform === "instagram") {
    const res = await igExchangeCode(igApp()!, code);
    if (!res.accounts.length) throw new EngineError("No Instagram Business or Creator account is linked to the Facebook Pages you shared.");
    for (const a of res.accounts) {
      const [c] = await db.insert(channels).values({ projectId: st.projectId, platform, externalId: a.igUserId, name: `@${a.username}`, tokenEncrypted: encrypt(res.token), expiresAt: res.expiresAt, createdBy: actor.userId }).returning();
      created.push(c.id);
    }
  } else {
    const res = await liExchangeCode(liApp()!, code);
    for (const a of res.authors) {
      const [c] = await db.insert(channels).values({ projectId: st.projectId, platform, externalId: a.urn, name: `${a.name}${a.kind === "organization" ? " (page)" : ""}`, tokenEncrypted: encrypt(res.token), expiresAt: res.expiresAt, createdBy: actor.userId }).returning();
      created.push(c.id);
    }
  }
  return { projectId: st.projectId, channelIds: created };
}

export async function listChannels(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "view");
  const rows = await db.select().from(channels).where(eq(channels.projectId, projectId)).orderBy(asc(channels.platform), asc(channels.name));
  return rows.map(({ tokenEncrypted: _t, ...c }) => ({ ...c, expired: !!c.expiresAt && c.expiresAt < new Date() }));
}

export async function deleteChannel(db: DB, actor: Actor, channelId: string) {
  const [c] = await db.select().from(channels).where(eq(channels.id, channelId));
  if (!c) throw new NotFound("Channel");
  await assertProject(db, actor, c.projectId, "channels.manage");
  await db.delete(channels).where(eq(channels.id, channelId));
}

/** Publishes now or at a time. The post must pass its quality checks in that format. */
export async function schedulePublication(db: DB, actor: Actor, postId: string, channelId: string, format: FormatId, at?: Date) {
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) throw new NotFound("Post");
  await assertProject(db, actor, post.projectId, "post.publish");
  const [ch] = await db.select().from(channels).where(and(eq(channels.id, channelId), eq(channels.projectId, post.projectId)));
  if (!ch) throw new NotFound("Channel");
  const pages = await db.select().from(postPages).where(eq(postPages.postId, postId));
  const allowed = PLATFORM_FORMATS[ch.platform as Platform][pages.length > 1 ? "carousel" : "single"];
  if (!allowed.includes(format)) throw new EngineError(`${FORMATS[format].label.split(" ·")[0]} ${pages.length > 1 ? "carousels" : "posts"} cannot be published to ${ch.platform}.`);
  const rendered = await renderPostInternal(db, postId, { formats: [format], createdBy: actor.userId });
  if (rendered.some((r) => !r.passed)) throw new EngineError("This post does not pass its quality checks in that format. Fix it before publishing.", 422);
  const when = at && at.getTime() > Date.now() ? at : new Date();
  const [pub] = await db.insert(publications).values({ postId, channelId, format, status: "scheduled", scheduledAt: when, createdBy: actor.userId }).returning();
  const job = await enqueue(db, "publish", { publicationId: pub.id }, { runAt: when, projectId: post.projectId, createdBy: actor.userId, maxAttempts: 4 });
  await db.update(publications).set({ jobId: job.id }).where(eq(publications.id, pub.id));
  await db.update(posts).set({ status: "scheduled", updatedAt: new Date() }).where(eq(posts.id, postId));
  return pub;
}

export async function cancelPublication(db: DB, actor: Actor, publicationId: string) {
  const [pub] = await db.select().from(publications).where(eq(publications.id, publicationId));
  if (!pub) throw new NotFound("Publication");
  const [post] = await db.select().from(posts).where(eq(posts.id, pub.postId));
  await assertProject(db, actor, post.projectId, "post.publish");
  if (pub.status !== "scheduled") throw new EngineError("Only scheduled posts can be cancelled.");
  await db.update(publications).set({ status: "cancelled" }).where(eq(publications.id, publicationId));
  if (pub.jobId) await db.update(jobs).set({ status: "cancelled" }).where(and(eq(jobs.id, pub.jobId), eq(jobs.status, "queued")));
}

export async function listPublications(db: DB, actor: Actor, projectId: string) {
  await assertProject(db, actor, projectId, "view");
  return db
    .select({ pub: publications, title: posts.title, channel: channels.name, platform: channels.platform })
    .from(publications)
    .innerJoin(posts, eq(posts.id, publications.postId))
    .innerJoin(channels, eq(channels.id, publications.channelId))
    .where(eq(posts.projectId, projectId))
    .orderBy(desc(publications.scheduledAt))
    .limit(200);
}

/** A time-limited public link to a render, for platforms that fetch images by URL. */
export function publicRenderUrl(renderId: string, ttlMs = 60 * 60_000): string {
  const exp = Date.now() + ttlMs;
  return `${appUrl()}/api/public/renders/${renderId}?sig=${encodeURIComponent(sign(`render:${renderId}`, exp))}`;
}

/** Job body. */
export async function runPublication(db: DB, publicationId: string) {
  const [pub] = await db.select().from(publications).where(eq(publications.id, publicationId));
  if (!pub || pub.status === "cancelled" || pub.status === "published") return { skipped: true };
  const [post] = await db.select().from(posts).where(eq(posts.id, pub.postId));
  const [ch] = await db.select().from(channels).where(eq(channels.id, pub.channelId));
  if (!post || !ch) throw new PublishError("The post or channel no longer exists.");
  await db.update(publications).set({ status: "publishing", error: null }).where(eq(publications.id, publicationId));
  try {
    const pages = await db.select().from(postPages).where(eq(postPages.postId, post.id)).orderBy(asc(postPages.index));
    const rows = await renderPostInternal(db, post.id, { formats: [pub.format as FormatId] });
    const ordered = pages.map((p) => rows.find((r) => r.pageId === p.id)!).filter(Boolean);
    if (ordered.some((r) => !r.passed)) throw new PublishError("The post no longer passes its quality checks.");
    const token = decrypt(ch.tokenEncrypted);
    const caption = captionText(post);
    let result: { id: string; url: string | null };
    if (ch.platform === "instagram") {
      result = await igPublish({ igUserId: ch.externalId, token, imageUrls: ordered.map((r) => publicRenderUrl(r.id)), caption, kind: pub.format === "story" ? "story" : "feed" });
    } else {
      const storage = getStorage();
      const files = await Promise.all(ordered.map((r) => storage.get(r.storageKey)));
      if (files.length > 1) {
        const pdf = await (await getRenderer()).pdf(files, FORMATS[pub.format as FormatId]);
        result = await liPublish({ token, author: ch.externalId, commentary: caption, document: { bytes: pdf, title: post.title } });
      } else {
        result = await liPublish({ token, author: ch.externalId, commentary: caption, images: [{ bytes: files[0], altText: post.altText }] });
      }
    }
    await db.update(publications).set({ status: "published", publishedAt: new Date(), externalId: result.id, url: result.url }).where(eq(publications.id, publicationId));
    await db.update(posts).set({ status: "published", updatedAt: new Date() }).where(eq(posts.id, post.id));
    await db.update(renders).set({ saved: true }).where(inArray(renders.id, ordered.map((r) => r.id)));
    return result;
  } catch (e) {
    await db.update(publications).set({ status: "failed", error: (e as Error).message }).where(eq(publications.id, publicationId));
    throw e;
  }
}
