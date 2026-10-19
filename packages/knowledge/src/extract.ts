import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";

export type EntityType = "article" | "event" | "product" | "person" | "organization" | "faq" | "video" | "course" | "other";

export interface Entity {
  type: EntityType;
  schemaType: string;
  name: string;
  description?: string;
  url?: string;
  image?: string;
  date?: string;
  data: Record<string, unknown>;
}

export interface ExtractedPage {
  url: string;
  canonical: string;
  title: string;
  description: string;
  image?: string;
  lang?: string;
  publishedAt?: string;
  text: string;
  headings: string[];
  links: string[];
  entities: Entity[];
}

const TYPE_MAP: Record<string, EntityType> = {
  article: "article", blogposting: "article", newsarticle: "article", report: "article", scholarlyarticle: "article", techarticle: "article",
  event: "event", educationevent: "event", socialevent: "event", businessevent: "event", exhibitionevent: "event", lecture: "event",
  product: "product", offer: "product", book: "product",
  person: "person",
  organization: "organization", educationalorganization: "organization", collegeoruniversity: "organization", ngo: "organization",
  faqpage: "faq",
  videoobject: "video",
  course: "course",
};

function str(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (Array.isArray(v)) return str(v[0]);
  if (v && typeof v === "object") return str((v as Record<string, unknown>).url ?? (v as Record<string, unknown>)["@id"] ?? (v as Record<string, unknown>).name);
  return undefined;
}

function flattenJsonLd(node: unknown, out: Record<string, unknown>[]) {
  if (Array.isArray(node)) return node.forEach((n) => flattenJsonLd(n, out));
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  if (o["@graph"]) flattenJsonLd(o["@graph"], out);
  if (o["@type"]) out.push(o);
}

export function extractEntities(document: Document, pageUrl: string): Entity[] {
  const nodes: Record<string, unknown>[] = [];
  for (const s of Array.from(document.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      flattenJsonLd(JSON.parse(s.textContent ?? ""), nodes);
    } catch {
      /* malformed JSON-LD is common; skip it */
    }
  }
  const out: Entity[] = [];
  for (const n of nodes) {
    const types = (Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]]).map(String);
    const schemaType = types[0];
    const type = types.map((t) => TYPE_MAP[t.toLowerCase()]).find(Boolean) ?? "other";
    if (type === "other" && /^(WebPage|WebSite|BreadcrumbList|ImageObject|SiteNavigationElement|SearchAction|ListItem)$/i.test(schemaType)) continue;
    const name = str(n.name) ?? str(n.headline) ?? "";
    if (!name && type !== "faq") continue;
    out.push({
      type,
      schemaType,
      name,
      description: str(n.description),
      url: abs(str(n.url), pageUrl) ?? pageUrl,
      image: abs(str(n.image), pageUrl),
      date: str(n.startDate) ?? str(n.datePublished) ?? str(n.uploadDate),
      data: n,
    });
  }
  return out;
}

function abs(u: string | undefined, base: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, base).toString();
  } catch {
    return undefined;
  }
}

export function normalizeUrl(u: string, base?: string): string | null {
  try {
    const url = new URL(u, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|fbclid|gclid|mc_)/i.test(k)) url.searchParams.delete(k);
    if (url.pathname !== "/" && url.pathname.endsWith("/")) url.pathname = url.pathname.slice(0, -1);
    return url.toString();
  } catch {
    return null;
  }
}

export function extractPage(html: string, url: string): ExtractedPage {
  const { document } = parseHTML(html);
  const meta = (sel: string) => document.querySelector(sel)?.getAttribute("content")?.trim() ?? "";
  const canonical = normalizeUrl(document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "", url) ?? url;
  const entities = extractEntities(document as unknown as Document, url);
  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => normalizeUrl(a.getAttribute("href") ?? "", url))
    .filter((x): x is string => !!x);
  const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
    .map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 40);
  const title = meta('meta[property="og:title"]') || (document.querySelector("title")?.textContent ?? "").trim() || headings[0] || url;
  const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
  const image = abs(meta('meta[property="og:image"]') || meta('meta[name="twitter:image"]'), url);
  const publishedAt = meta('meta[property="article:published_time"]') || entities.find((e) => e.type === "article")?.date;
  let text = "";
  try {
    const article = new Readability(parseHTML(html).document as unknown as Document, { charThreshold: 200 }).parse();
    text = article?.textContent ?? "";
  } catch {
    /* fall back to body text */
  }
  if (text.trim().length < 200) {
    const { document: d2 } = parseHTML(html);
    d2.querySelectorAll("script, style, noscript, nav, footer, header, svg").forEach((n) => n.remove());
    text = d2.querySelector("body")?.textContent ?? "";
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim();
  return { url, canonical, title, description, image, lang: document.documentElement?.getAttribute("lang") ?? undefined, publishedAt: publishedAt || undefined, text, headings, links, entities };
}
