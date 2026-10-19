import type { QualityIssue, TemplateSpec, TokensFile } from "@sme/core";
import { referencedNames, validateTemplateSyntax } from "./template";
import type { BrandRules } from "./rules";

export interface LintContext {
  tokens: TokensFile;
  assetPaths: Set<string>;
  rules: BrandRules;
}

const NAMED_COLORS = /(^|[\s,(:])(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|brown|navy|teal|maroon|olive|silver|gold|cyan|magenta|lime|aqua|fuchsia|beige|ivory|coral|crimson|salmon|tomato|khaki|indigo|violet)(?=[\s,;)!]|$)/i;
const COLOR_PROPS = /^(color|background|background-color|border|border-color|border-(top|right|bottom|left)(-color)?|outline|outline-color|fill|stroke|box-shadow|text-shadow|text-decoration-color|caret-color|column-rule|column-rule-color|accent-color)$/i;

export interface Declaration {
  prop: string;
  value: string;
  where: string;
}

/** Pulls `prop: value` declarations out of CSS text, <style> blocks and style="" attributes. */
export function declarations(spec: Pick<TemplateSpec, "html" | "css">): Declaration[] {
  const out: Declaration[] = [];
  const scan = (css: string, where: string) => {
    const noComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const re = /([a-zA-Z-]+)\s*:\s*([^;{}]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(noComments))) {
      const prop = m[1].toLowerCase();
      if (prop.startsWith("--")) continue;
      out.push({ prop, value: m[2].trim(), where });
    }
  };
  scan(spec.css ?? "", "CSS");
  for (const m of spec.html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) scan(m[1], "<style> in HTML");
  for (const m of spec.html.matchAll(/style\s*=\s*"([^"]*)"/gi)) scan(m[1], "style attribute");
  for (const m of spec.html.matchAll(/style\s*=\s*'([^']*)'/gi)) scan(m[1], "style attribute");
  return out;
}

function knownVars(tokens: TokensFile): Set<string> {
  const names = new Set<string>();
  for (const e of tokens.color?.tokens ?? []) names.add(e.name);
  for (const e of tokens.shadow?.tokens ?? []) names.add(e.name);
  for (const [k, fam] of Object.entries(tokens)) {
    const list = (fam as { tokens?: { name: string }[] })?.tokens;
    if (Array.isArray(list) && k !== "color") for (const e of list) names.add(e.name);
  }
  for (const k of Object.keys(tokens.type?.families ?? {})) names.add(`font-${k.toLowerCase()}`);
  return names;
}

/**
 * Template linter: templates may only use the design system's vocabulary
 * (colour tokens, font families), never scripts or remote resources.
 */
export function lintTemplate(spec: TemplateSpec, ctx: LintContext): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const err = (message: string, slot?: string) => issues.push({ code: "lint", severity: "error", message, slot });
  const warn = (message: string, slot?: string) => issues.push({ code: "lint", severity: "warning", message, slot });

  const syntax = validateTemplateSyntax(spec);
  if (syntax) err(`Template syntax error: ${syntax}`);

  const both = `${spec.html}\n${spec.css}`;
  if (/<script\b/i.test(both)) err("Templates cannot contain <script>.");
  if (/\son[a-z]+\s*=/i.test(spec.html)) err("Templates cannot contain event handler attributes (onclick=…).");
  if (/javascript:/i.test(both)) err("Templates cannot contain javascript: URLs.");
  if (/<(iframe|object|embed|frame|link|meta|base)\b/i.test(spec.html)) err("Templates cannot embed iframes, objects, <link>, <meta> or <base>.");
  if (/@import/i.test(both)) err("Templates cannot @import stylesheets.");
  if (/(src|href)\s*=\s*["']?\s*(https?:)?\/\//i.test(spec.html) || /url\(\s*["']?\s*(https?:)?\/\//i.test(both))
    err("Templates cannot load remote files. Use {{asset \"Group/file\"}} or an image slot.");

  const vars = knownVars(ctx.tokens);
  const neverText = new Set(ctx.rules.neverText.map((r) => r.token));
  for (const d of declarations(spec)) {
    const v = d.value.replace(/\{\{[\s\S]*?\}\}/g, "");
    if (COLOR_PROPS.test(d.prop) || d.prop.startsWith("background") || d.prop.includes("color")) {
      if (/#[0-9a-f]{3,8}\b/i.test(v)) err(`Raw hex colour in ${d.where} (${d.prop}: ${d.value}). Use a colour token, e.g. var(--token).`);
      if (/\b(rgba?|hsla?|oklch|oklab|lab|lch)\(\s*\d/i.test(v)) err(`Raw colour function in ${d.where} (${d.prop}: ${d.value}). Use var(--token), or color-mix(in srgb, var(--token) 60%, transparent) for tints.`);
      if (NAMED_COLORS.test(` ${v}`)) err(`Named colour in ${d.where} (${d.prop}: ${d.value}). Use a colour token.`);
    }
    if (d.prop === "font-family" && !/^(var\(--font-[a-z0-9_-]+\)|inherit)$/i.test(v.trim()))
      err(`font-family must be a design-system family, e.g. var(--font-serif) (found "${d.value}" in ${d.where}).`);
    if (d.prop === "font" && !/var\(--font-/i.test(v)) err(`The font shorthand must use a design-system family (found "${d.value}").`);
    if (d.prop === "color") {
      const m = /var\(--([A-Za-z0-9_.-]+)/.exec(v);
      if (m && neverText.has(m[1])) err(`"${m[1]}" may never set text (design-system rule), but ${d.where} uses it as a text colour.`);
    }
    for (const m of v.matchAll(/var\(--([A-Za-z0-9_.\\-]+)/g)) {
      const name = m[1].replace(/\\/g, "");
      if (!vars.has(name)) warn(`var(--${name}) is not defined by the design system.`);
    }
  }

  // Classes that share a name with a design-system type style pick up its styles.
  const styleNames = new Set((ctx.tokens.type?.groups ?? []).flatMap((g) => (g.styles ?? []).map((st) => st.name)));
  const classes = new Set([...spec.html.matchAll(/class\s*=\s*["']([^"']+)["']/g)].flatMap((m) => m[1].split(/\s+/)));
  for (const c of classes)
    if (styleNames.has(c)) warn(`The class "${c}" is also a design-system type style, so its font, size and spacing apply here. Rename it if that is not intended.`);

  // Assets
  for (const m of both.matchAll(/\{\{\s*asset\s+["']([^"']+)["']\s*\}\}/g)) {
    const p = m[1].replace(/^asset:/, "");
    const full = p.startsWith("assets/") ? p : `assets/${p}`;
    if (!ctx.assetPaths.has(full)) err(`Asset "${p}" does not exist in the design system.`);
  }

  // Slots
  const names = new Set(spec.slots.map((s) => s.name));
  const used = referencedNames(both);
  for (const s of spec.slots) {
    if (!used.has(s.name)) warn(`Slot "${s.name}" is declared but never used in the template.`, s.name);
    if (s.type !== "image" && !new RegExp(`data-slot=["']${s.name}["']`).test(spec.html))
      warn(`Slot "${s.name}" has no element with data-slot="${s.name}", so text-fit checks cannot measure it.`, s.name);
    if (s.type === "choice" && !s.options?.length) err(`Choice slot "${s.name}" needs options.`, s.name);
  }
  const reserved = new Set(["format", "page", "this", "else", "true", "false", "project", "handle"]);
  for (const n of used) if (!names.has(n) && !reserved.has(n)) warn(`The template uses "${n}" but no slot with that name exists.`);
  if (!/data-role=["']logo["']/.test(spec.html) && !/\{\{\s*asset\s+["'][^"']*frame/i.test(both))
    warn('No logo element (data-role="logo") and no brand frame: the logo check cannot confirm the signature.');
  return issues;
}
