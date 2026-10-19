import { describe, expect, it } from "vitest";
import { escapeLittleText, igPublish, liPublish } from "../src";

function mockFetch(handler: (url: string, init?: RequestInit) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = handler(String(url), init);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status ?? 200, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("instagram", () => {
  it("publishes a carousel: children, container, wait, publish", async () => {
    let n = 0;
    const { f, calls } = mockFetch((url, init) => {
      if (url.includes("/media_publish")) return { body: { id: "media-1" } };
      if (init?.method === "POST") return { body: { id: `c${++n}` } };
      if (url.includes("fields=permalink")) return { body: { permalink: "https://instagram.com/p/x" } };
      return { body: { status_code: "FINISHED" } };
    });
    const res = await igPublish({ igUserId: "17", token: "t", imageUrls: ["https://a/1.png", "https://a/2.png"], caption: "Hello", kind: "feed" }, f, async () => {});
    expect(res).toEqual({ id: "media-1", url: "https://instagram.com/p/x" });
    const posts = calls.filter((c) => c.init?.method === "POST").map((c) => Object.fromEntries(new URLSearchParams(String(c.init!.body))));
    expect(posts[0]).toMatchObject({ image_url: "https://a/1.png", is_carousel_item: "true" });
    expect(posts[2]).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: "Hello" });
    expect(posts[3]).toMatchObject({ creation_id: "c3" });
  });

  it("surfaces processing errors", async () => {
    const { f } = mockFetch((url, init) => (init?.method === "POST" ? { body: { id: "c1" } } : { body: { status_code: "ERROR", status: "bad image" } }));
    await expect(igPublish({ igUserId: "1", token: "t", imageUrls: ["u"], caption: "", kind: "feed" }, f, async () => {})).rejects.toThrow(/bad image/);
  });
});

describe("linkedin", () => {
  it("uploads a document and creates a post with versioned headers", async () => {
    const { f, calls } = mockFetch((url) => {
      if (url.includes("initializeUpload")) return { body: { value: { uploadUrl: "https://upload/x", document: "urn:li:document:D1" } } };
      if (url.startsWith("https://upload")) return { status: 201 };
      return { status: 201, headers: { "x-restli-id": "urn:li:share:9" } };
    });
    const res = await liPublish({ token: "t", author: "urn:li:organization:5", commentary: "Five things (a list) #history", document: { bytes: new Uint8Array([37, 80]), title: "Deck" } }, f);
    expect(res.id).toBe("urn:li:share:9");
    const post = calls.find((c) => c.url.endsWith("/rest/posts"))!;
    const headers = post.init!.headers as Record<string, string>;
    expect(headers["LinkedIn-Version"]).toMatch(/^\d{6}$/);
    const body = JSON.parse(String(post.init!.body));
    expect(body.content.media).toEqual({ id: "urn:li:document:D1", title: "Deck" });
    expect(body.commentary).toBe("Five things \\(a list\\) \\#history");
  });

  it("escapes little-text reserved characters", () => {
    expect(escapeLittleText("a_b*c@d")).toBe("a\\_b\\*c\\@d");
  });
});
