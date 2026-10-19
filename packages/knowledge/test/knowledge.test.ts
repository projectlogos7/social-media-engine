import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { chunkText, crawlSite, parseRobots } from "../src";

let server: Server;
let base = "";
const article = (title: string) => `<!doctype html><html lang="en"><head><title>${title} | Site</title>
<meta name="description" content="About ${title}"><meta property="og:image" content="/img/${title}.jpg">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage","name":"x"},{"@type":"BlogPosting","headline":"${title}","datePublished":"2026-09-01","image":"/img/a.jpg"}]}</script>
</head><body><nav><a href="/">Home</a></nav><article><h1>${title}</h1>${"<p>Islam reached the Malabar coast through trade, centuries before any Muslim ruler governed the north. ".repeat(6)}</p></article>
<a href="/blog/second?utm_source=x">next</a><a href="/private/secret">secret</a><a href="https://other.example/">out</a></body></html>`;
const PAGES: Record<string, [string, string]> = {
  "/robots.txt": ["text/plain", "User-agent: *\nDisallow: /private\nSitemap: SITEMAP"],
  "/sitemap.xml": ["application/xml", `<?xml version="1.0"?><urlset><url><loc>BASE/events/lecture</loc><lastmod>2026-10-01</lastmod></url></urlset>`],
  "/": ["text/html", `<html><head><title>Home</title></head><body><a href="/blog/first">First</a></body></html>`],
  "/blog/first": ["text/html", article("First post")],
  "/blog/second": ["text/html", article("Second post")],
  "/events/lecture": ["text/html", `<html><head><title>Lecture</title><script type="application/ld+json">{"@type":"Event","name":"Coast before conquest","startDate":"2027-01-09T11:00","description":"A lecture"}</script></head><body><p>Join us.</p></body></html>`],
  "/private/secret": ["text/html", "<p>no</p>"],
};

beforeAll(async () => {
  server = createServer((req, res) => {
    const p = PAGES[(req.url ?? "/").split("?")[0]];
    if (!p) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": p[0] }).end(p[1].replaceAll("BASE", base).replace("SITEMAP", `${base}/sitemap.xml`));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => server.close());

describe("knowledge", () => {
  it("parses robots.txt with longest match", () => {
    const r = parseRobots("User-agent: *\nDisallow: /a\nAllow: /a/b\nSitemap: https://x/s.xml", "bot");
    expect(r.allowed("/a/c")).toBe(false);
    expect(r.allowed("/a/b/c")).toBe(true);
    expect(r.allowed("/z")).toBe(true);
    expect(r.sitemaps).toEqual(["https://x/s.xml"]);
  });

  it("crawls sitemap + links, obeys robots, extracts entities", async () => {
    const res = await crawlSite({ startUrl: base, maxPages: 20 });
    const urls = res.pages.map((p) => new URL(p.url).pathname).sort();
    expect(urls).toEqual(["/", "/blog/first", "/blog/second", "/events/lecture"]);
    expect(res.skipped).toContainEqual(expect.objectContaining({ reason: "robots.txt" }));
    const first = res.pages.find((p) => p.url.endsWith("/blog/first"))!;
    expect(first.title).toBe("First post | Site");
    expect(first.image).toBe(`${base}/img/First post.jpg`.replace(" ", "%20"));
    expect(first.entities[0]).toMatchObject({ type: "article", name: "First post", date: "2026-09-01" });
    expect(first.text).toMatch(/Malabar coast/);
    const ev = res.pages.find((p) => p.url.endsWith("/events/lecture"))!;
    expect(ev.entities[0]).toMatchObject({ type: "event", name: "Coast before conquest", date: "2027-01-09T11:00" });
  });

  it("chunks long text with overlap", () => {
    const text = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} has some words in it. It goes on a bit.`).join("\n\n");
    const chunks = chunkText(text, 300, 50);
    expect(chunks.length).toBeGreaterThan(4);
    expect(chunks.every((c) => c.length <= 450)).toBe(true);
  });
});
