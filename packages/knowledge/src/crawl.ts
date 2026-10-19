import { extractPage, normalizeUrl, type ExtractedPage } from "./extract";
import { parseRobots, type Robots } from "./robots";

export const USER_AGENT = "SocialMediaEngineBot/1.0 (+content import for the site owner)";

export interface CrawlOptions {
  startUrl: string;
  maxPages?: number;
  /** Only crawl URLs under this path prefix. */
  pathPrefix?: string;
  /** Fetches rendered HTML for JS-heavy pages (headless browser). */
  renderJs?: (url: string) => Promise<string>;
  fetchImpl?: typeof fetch;
  concurrency?: number;
  onPage?: (page: ExtractedPage) => void | Promise<void>;
  /** Stop early, e.g. when the job is cancelled. */
  signal?: AbortSignal;
}

export interface CrawlResult {
  pages: ExtractedPage[];
  skipped: { url: string; reason: string }[];
  sitemapUrls: number;
}

async function get(f: typeof fetch, url: string): Promise<Response | null> {
  try {
    return await f(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  } catch {
    return null;
  }
}

async function readSitemaps(f: typeof fetch, urls: string[], limit: number): Promise<{ loc: string; lastmod?: string }[]> {
  const out: { loc: string; lastmod?: string }[] = [];
  const queue = [...urls];
  const seen = new Set<string>();
  while (queue.length && seen.size < 50 && out.length < limit * 4) {
    const u = queue.shift()!;
    if (seen.has(u)) continue;
    seen.add(u);
    const r = await get(f, u);
    if (!r?.ok) continue;
    const xml = await r.text();
    const locs = [...xml.matchAll(/<(sitemap|url)>([\s\S]*?)<\/\1>/g)];
    for (const [, kind, body] of locs) {
      const loc = /<loc>\s*([^<]+?)\s*<\/loc>/.exec(body)?.[1]?.replace(/&amp;/g, "&");
      if (!loc) continue;
      if (kind === "sitemap") queue.push(loc);
      else out.push({ loc, lastmod: /<lastmod>\s*([^<]+?)\s*<\/lastmod>/.exec(body)?.[1] });
    }
  }
  // newest first, so a page budget keeps recent content
  return out.sort((a, b) => (b.lastmod ?? "").localeCompare(a.lastmod ?? ""));
}

/** Crawls one site: sitemap URLs first, then same-origin links, respecting robots.txt. */
export async function crawlSite(o: CrawlOptions): Promise<CrawlResult> {
  const f = o.fetchImpl ?? fetch;
  const start = normalizeUrl(o.startUrl);
  if (!start) throw new Error(`"${o.startUrl}" is not a valid http(s) URL.`);
  const origin = new URL(start).origin;
  const maxPages = o.maxPages ?? 200;
  const prefix = o.pathPrefix ?? "";

  const robotsRes = await get(f, `${origin}/robots.txt`);
  const robots: Robots = parseRobots(robotsRes?.ok ? await robotsRes.text() : "", USER_AGENT);
  const sitemapList = robots.sitemaps.length ? robots.sitemaps : [`${origin}/sitemap.xml`];
  const fromSitemaps = await readSitemaps(f, sitemapList, maxPages);

  const queue: string[] = [start, ...fromSitemaps.map((s) => normalizeUrl(s.loc)).filter((x): x is string => !!x)];
  const seen = new Set<string>();
  const pages: ExtractedPage[] = [];
  const skipped: CrawlResult["skipped"] = [];
  const inScope = (u: string) => {
    const url = new URL(u);
    return url.origin === origin && url.pathname.startsWith(prefix) && !/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3|docx?|xlsx?|pptx?|ics|xml|json|css|js)$/i.test(url.pathname);
  };

  const worker = async () => {
    while (queue.length && pages.length < maxPages && !o.signal?.aborted) {
      const url = queue.shift()!;
      if (seen.has(url)) continue;
      seen.add(url);
      if (!inScope(url)) continue;
      const path = new URL(url).pathname + new URL(url).search;
      if (!robots.allowed(path)) {
        skipped.push({ url, reason: "robots.txt" });
        continue;
      }
      if (robots.crawlDelayMs) await new Promise((r) => setTimeout(r, robots.crawlDelayMs));
      const r = await get(f, url);
      if (!r) {
        skipped.push({ url, reason: "network error" });
        continue;
      }
      if (!r.ok) {
        skipped.push({ url, reason: `HTTP ${r.status}` });
        continue;
      }
      if (!(r.headers.get("content-type") ?? "").includes("html")) {
        skipped.push({ url, reason: "not HTML" });
        continue;
      }
      let html = await r.text();
      let page = extractPage(html, normalizeUrl(r.url) ?? url);
      if (page.text.length < 300 && o.renderJs) {
        try {
          html = await o.renderJs(url);
          page = extractPage(html, url);
        } catch {
          /* keep the static version */
        }
      }
      if (page.canonical !== page.url && seen.has(page.canonical)) continue;
      seen.add(page.canonical);
      pages.push(page);
      await o.onPage?.(page);
      for (const l of page.links) if (!seen.has(l) && inScope(l)) queue.push(l);
    }
  };
  await Promise.all(Array.from({ length: o.concurrency ?? 2 }, worker));
  return { pages, skipped, sitemapUrls: fromSitemaps.length };
}
