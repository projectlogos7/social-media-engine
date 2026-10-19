import { json, PublishError, type Fetch } from "./http";

/** LinkedIn Posts API (versioned REST). Members and organization pages. */
export const LI_API = "https://api.linkedin.com";
export const LI_VERSION = "202509";
export const LI_SCOPES = ["openid", "profile", "w_member_social", "w_organization_social", "r_organization_admin"];

export interface LiApp {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function liAuthUrl(app: LiApp, state: string, scopes = LI_SCOPES): string {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", app.clientId);
  u.searchParams.set("redirect_uri", app.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("scope", scopes.join(" "));
  return u.toString();
}

const rest = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": LI_VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
  ...extra,
});

export interface LiAuthor {
  urn: string;
  name: string;
  kind: "person" | "organization";
}

export async function liExchangeCode(app: LiApp, code: string, f: Fetch = fetch): Promise<{ token: string; expiresAt: Date | null; authors: LiAuthor[] }> {
  const tok = await json<{ access_token: string; expires_in?: number }>(
    await f("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: app.redirectUri, client_id: app.clientId, client_secret: app.clientSecret }),
    }),
    "LinkedIn token exchange",
  );
  const me = await json<{ sub: string; name?: string }>(await f(`${LI_API}/v2/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } }), "LinkedIn profile");
  const authors: LiAuthor[] = [{ urn: `urn:li:person:${me.sub}`, name: me.name ?? "Me", kind: "person" }];
  try {
    const acls = await json<{ elements: { organization: string }[] }>(
      await f(`${LI_API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: rest(tok.access_token) }),
      "LinkedIn pages",
    );
    for (const a of acls.elements ?? []) {
      const id = a.organization.split(":").pop();
      let name = a.organization;
      try {
        name = (await json<{ localizedName?: string }>(await f(`${LI_API}/rest/organizations/${id}`, { headers: rest(tok.access_token) }), "Page name")).localizedName ?? name;
      } catch {}
      authors.push({ urn: a.organization, name, kind: "organization" });
    }
  } catch {
    /* no page admin scope or no pages: member posting still works */
  }
  return { token: tok.access_token, expiresAt: tok.expires_in ? new Date(Date.now() + tok.expires_in * 1000) : null, authors };
}

/** LinkedIn "little text": these characters must be escaped in commentary. */
export function escapeLittleText(s: string): string {
  return s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

async function upload(f: Fetch, token: string, kind: "images" | "documents", owner: string, bytes: Uint8Array, contentType: string): Promise<string> {
  const init = await json<{ value: { uploadUrl: string; image?: string; document?: string } }>(
    await f(`${LI_API}/rest/${kind}?action=initializeUpload`, {
      method: "POST",
      headers: rest(token, { "Content-Type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner } }),
    }),
    `Starting the ${kind === "images" ? "image" : "document"} upload`,
  );
  const put = await f(init.value.uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType }, body: new Uint8Array(bytes) });
  if (!put.ok) throw new PublishError(`Uploading to LinkedIn failed (${put.status}).`, put.status, put.status >= 500);
  const urn = init.value.image ?? init.value.document;
  if (!urn) throw new PublishError("LinkedIn did not return an upload id.");
  return urn;
}

export interface LiPublishInput {
  token: string;
  author: string;
  commentary: string;
  /** One image, several images (multi-image post), or one PDF (document carousel). */
  images?: { bytes: Uint8Array; altText: string }[];
  document?: { bytes: Uint8Array; title: string };
}

export async function liPublish(input: LiPublishInput, f: Fetch = fetch): Promise<{ id: string; url: string | null }> {
  const { token, author } = input;
  let content: Record<string, unknown> | undefined;
  if (input.document) {
    const urn = await upload(f, token, "documents", author, input.document.bytes, "application/pdf");
    content = { media: { id: urn, title: input.document.title.slice(0, 200) } };
  } else if (input.images?.length === 1) {
    const urn = await upload(f, token, "images", author, input.images[0].bytes, "image/png");
    content = { media: { id: urn, altText: input.images[0].altText.slice(0, 4086) } };
  } else if (input.images && input.images.length > 1) {
    const ids = [];
    for (const im of input.images.slice(0, 20)) ids.push({ id: await upload(f, token, "images", author, im.bytes, "image/png"), altText: im.altText.slice(0, 4086) });
    content = { multiImage: { images: ids } };
  }
  const res = await f(`${LI_API}/rest/posts`, {
    method: "POST",
    headers: rest(token, { "Content-Type": "application/json" }),
    body: JSON.stringify({
      author,
      commentary: escapeLittleText(input.commentary),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      ...(content ? { content } : {}),
      lifecycleState: "PUBLISHED",
      isReschedulable: false,
    }),
  });
  if (!res.ok) await json(res, "Creating the LinkedIn post");
  const id = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id") ?? "";
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
}
