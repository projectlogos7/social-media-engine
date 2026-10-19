import Handlebars from "handlebars";
import { type Format, type SlotValues, type TemplateSpec, isImageRef } from "@sme/core";

export interface TemplateContext {
  format: Format;
  slots: SlotValues;
  /** asset path ("assets/Lockups/x.svg" or "Lockups/x.svg") -> URL (data URI when rendering). */
  assetUrl: (path: string) => string | null;
  /** library/generation asset id -> URL. */
  imageUrl: (assetId: string) => string | null;
  /** Carousel page info, when rendering a page of a carousel. */
  page?: { index: number; count: number };
  /** Extra variables (project name, handle...). */
  vars?: Record<string, unknown>;
}

function makeEnv(ctx: TemplateContext, missing: string[]) {
  const hb = Handlebars.create();
  const assetHelper = (path: unknown) => {
    const p = String(path).replace(/^asset:/, "");
    const full = p.startsWith("assets/") ? p : `assets/${p}`;
    const url = ctx.assetUrl(full);
    if (!url) missing.push(`asset:${full}`);
    return new hb.SafeString(url ?? "");
  };
  hb.registerHelper("asset", assetHelper);
  hb.registerHelper("image", (slot: unknown) => {
    const v = ctx.slots[String(slot)];
    if (!isImageRef(v)) return new hb.SafeString("");
    const url = ctx.imageUrl(v.assetId);
    if (!url) missing.push(`image:${v.assetId}`);
    return new hb.SafeString(url ?? "");
  });
  hb.registerHelper("focus", (slot: unknown) => {
    const v = ctx.slots[String(slot)];
    if (!isImageRef(v)) return "50% 50%";
    return `${Math.round((v.focusX ?? 0.5) * 100)}% ${Math.round((v.focusY ?? 0.5) * 100)}%`;
  });
  hb.registerHelper("has", (slot: unknown) => {
    const v = ctx.slots[String(slot)];
    return Array.isArray(v) ? v.length > 0 : isImageRef(v) || (typeof v === "string" && v.trim().length > 0);
  });
  hb.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  hb.registerHelper("not", (a: unknown) => !a);
  hb.registerHelper("upper", (s: unknown) => String(s ?? "").toUpperCase());
  hb.registerHelper("lower", (s: unknown) => String(s ?? "").toLowerCase());
  hb.registerHelper("inc", (n: unknown) => Number(n) + 1);
  hb.registerHelper("pad2", (n: unknown) => String(n).padStart(2, "0"));
  hb.registerHelper("nl2br", (s: unknown) => new hb.SafeString(hb.escapeExpression(String(s ?? "")).replace(/\n/g, "<br>")));
  return hb;
}

export interface CompiledTemplate {
  html: string;
  css: string;
  missing: string[];
}

/** Renders a template's Handlebars HTML and CSS with slot values. Output is escaped by default. */
export function compileTemplate(spec: Pick<TemplateSpec, "html" | "css">, ctx: TemplateContext): CompiledTemplate {
  const missing: string[] = [];
  const hb = makeEnv(ctx, missing);
  const data = {
    ...ctx.vars,
    ...Object.fromEntries(Object.entries(ctx.slots).map(([k, v]) => [k, isImageRef(v) ? v.assetId : v])),
    format: ctx.format,
    page: ctx.page,
  };
  const opts = { strict: false, noEscape: false } as const;
  const html = hb.compile(spec.html, opts)(data);
  const css = spec.css ? hb.compile(spec.css, opts)(data) : "";
  return { html, css, missing };
}

/** Names referenced as {{name}}, {{#if name}}, {{#each name}}, (image "name") etc. */
export function referencedNames(source: string): Set<string> {
  const names = new Set<string>();
  const re = /\{\{\{?\s*(?:[#/^]?(?:if|unless|each|with)\s+)?(?:\(?\s*(?:has|image|focus|upper|lower|nl2br)\s+)?["']?([a-z][a-z0-9_]*)["']?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) names.add(m[1]);
  return names;
}

export function validateTemplateSyntax(spec: Pick<TemplateSpec, "html" | "css">): string | null {
  try {
    Handlebars.precompile(spec.html);
    if (spec.css) Handlebars.precompile(spec.css);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
