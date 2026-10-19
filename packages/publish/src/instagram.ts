import { json, PublishError, type Fetch } from "./http";

/**
 * Instagram publishing through the Instagram Graph API (Facebook Login for
 * Business). Needs a Business or Creator account linked to a Facebook Page.
 * Images are fetched by Instagram from public URLs, so the engine passes
 * signed, time-limited links to the rendered files.
 */
export const IG_GRAPH = "https://graph.facebook.com/v21.0";
export const IG_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement", "business_management"];

export interface IgApp {
  appId: string;
  appSecret: string;
  redirectUri: string;
}

export function igAuthUrl(app: IgApp, state: string): string {
  const u = new URL("https://www.facebook.com/v21.0/dialog/oauth");
  u.searchParams.set("client_id", app.appId);
  u.searchParams.set("redirect_uri", app.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", IG_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export interface IgAccount {
  igUserId: string;
  username: string;
  pageName: string;
}

/** Code -> long-lived user token (about 60 days) + the Instagram accounts it can publish to. */
export async function igExchangeCode(app: IgApp, code: string, f: Fetch = fetch): Promise<{ token: string; expiresAt: Date | null; accounts: IgAccount[] }> {
  const short = await json<{ access_token: string }>(
    await f(`${IG_GRAPH}/oauth/access_token?${new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: app.redirectUri, code })}`),
    "Facebook token exchange",
  );
  const long = await json<{ access_token: string; expires_in?: number }>(
    await f(`${IG_GRAPH}/oauth/access_token?${new URLSearchParams({ grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: short.access_token })}`),
    "Facebook long-lived token",
  );
  const pages = await json<{ data: { name: string; instagram_business_account?: { id: string; username?: string } }[] }>(
    await f(`${IG_GRAPH}/me/accounts?${new URLSearchParams({ fields: "name,instagram_business_account{id,username}", access_token: long.access_token })}`),
    "Listing Facebook Pages",
  );
  const accounts = pages.data
    .filter((p) => p.instagram_business_account)
    .map((p) => ({ igUserId: p.instagram_business_account!.id, username: p.instagram_business_account!.username ?? p.name, pageName: p.name }));
  return { token: long.access_token, expiresAt: long.expires_in ? new Date(Date.now() + long.expires_in * 1000) : null, accounts };
}

export interface IgPublishInput {
  igUserId: string;
  token: string;
  imageUrls: string[];
  caption: string;
  kind: "feed" | "story";
}

async function waitReady(f: Fetch, id: string, token: string, sleep: (ms: number) => Promise<void>) {
  for (let i = 0; i < 30; i++) {
    const s = await json<{ status_code?: string; status?: string }>(await f(`${IG_GRAPH}/${id}?${new URLSearchParams({ fields: "status_code,status", access_token: token })}`), "Checking media status");
    if (s.status_code === "FINISHED" || s.status_code === undefined) return;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new PublishError(`Instagram could not process the image: ${s.status ?? s.status_code}`);
    await sleep(2000);
  }
  throw new PublishError("Instagram took too long to process the media.", undefined, true);
}

/** Publishes one image, a story, or a carousel (2–10 images). Returns the media id and permalink. */
export async function igPublish(input: IgPublishInput, f: Fetch = fetch, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<{ id: string; url: string | null }> {
  const { igUserId, token, imageUrls, caption } = input;
  if (!imageUrls.length) throw new PublishError("Nothing to publish.");
  if (imageUrls.length > 10) throw new PublishError("Instagram carousels hold at most 10 images.");
  const post = (path: string, params: Record<string, string>) =>
    f(`${IG_GRAPH}/${path}`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ ...params, access_token: token }) });

  let creationId: string;
  if (input.kind === "story") {
    creationId = (await json<{ id: string }>(await post(`${igUserId}/media`, { image_url: imageUrls[0], media_type: "STORIES" }), "Creating the story")).id;
  } else if (imageUrls.length === 1) {
    creationId = (await json<{ id: string }>(await post(`${igUserId}/media`, { image_url: imageUrls[0], caption }), "Creating the post")).id;
  } else {
    const children: string[] = [];
    for (const url of imageUrls) {
      const c = await json<{ id: string }>(await post(`${igUserId}/media`, { image_url: url, is_carousel_item: "true" }), "Uploading a carousel image");
      children.push(c.id);
    }
    for (const c of children) await waitReady(f, c, token, sleep);
    creationId = (await json<{ id: string }>(await post(`${igUserId}/media`, { media_type: "CAROUSEL", children: children.join(","), caption }), "Creating the carousel")).id;
  }
  await waitReady(f, creationId, token, sleep);
  const published = await json<{ id: string }>(await post(`${igUserId}/media_publish`, { creation_id: creationId }), "Publishing");
  let url: string | null = null;
  try {
    url = (await json<{ permalink?: string }>(await f(`${IG_GRAPH}/${published.id}?${new URLSearchParams({ fields: "permalink", access_token: token })}`), "Permalink")).permalink ?? null;
  } catch {
    /* the post is live even if the permalink lookup fails */
  }
  return { id: published.id, url };
}
