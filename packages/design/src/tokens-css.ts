import type { TokenEntry, TokensFile, TypeStyle } from "@sme/core";

/**
 * Compiles a Claude Design System tokens.json to CSS the same way the Design
 * System artifact does:
 *   :root, [data-theme="<first>"] { --<color>; --<shadow> }
 *   [data-theme="<id>"] { overrides }
 *   :root { --<space>; --<radius>; --<other>; --font-<key> }
 *   .<style> { … } per type style, @font-face per font.
 */

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const COLOR_RE = /^(#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([0-9a-zA-Z\s.,%/+-]*\))$/;
const ALIAS_RE = /^\{([A-Za-z0-9][A-Za-z0-9_.-]{0,63})\}$/;
const LENGTH_RE = /^(-?\d*\.?\d+(px|rem|em|%)|0)$/;
const PLAIN_VALUE_RE = /^[A-Za-z0-9 #%(),./+_-]{1,200}$/;
const FAMILY_RE = /^[^;{}<>\\()]{1,200}$/;
const KNOWN_FAMILIES = new Set(["name", "version", "color", "type", "shadow"]);

export interface CompileOptions {
  /** Resolves a font file path (e.g. "fonts/X.woff2") to a URL usable in src: url(...). */
  fontSrc?: (file: string) => string | null;
}

export interface CompiledTokens {
  css: string;
  themes: string[];
  warnings: string[];
}

function cssName(name: string): string {
  return name.replace(/^(--|\.)/, "").replace(/\./g, "\\.");
}

function cleanName(name: string): string | null {
  const n = name.replace(/^(--|\.)/, "");
  return NAME_RE.test(n) ? n : null;
}

function px(v: string | number | undefined): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return `${v}px`;
  return LENGTH_RE.test(v.trim()) ? v.trim() : undefined;
}

function lineHeight(v: string | number | undefined): string | undefined {
  if (v === undefined || v === "") return undefined;
  if (typeof v === "number") return v < 10 ? String(v) : `${v}px`;
  const s = v.trim();
  if (/^\d*\.?\d+$/.test(s) && parseFloat(s) < 10) return s;
  return px(s);
}

function weight(v: string | number | undefined): string | undefined {
  if (v === undefined) return undefined;
  if (v === "normal") return "400";
  if (v === "bold") return "700";
  const s = String(v).trim();
  return /^\d{1,4}(\s+\d{1,4})?$/.test(s) ? s : undefined;
}

export function colorValue(raw: string, known: Set<string>): string | null {
  const s = raw.trim();
  const alias = ALIAS_RE.exec(s);
  if (alias) return known.has(alias[1]) ? `var(--${cssName(alias[1])})` : null;
  return COLOR_RE.test(s) && !/var\(|url\(|color-mix/i.test(s) ? s.toLowerCase() : null;
}

export function themeIds(tokens: TokensFile): string[] {
  const t = tokens.color?.themes?.map((x) => x.id.toLowerCase()).filter((x) => NAME_RE.test(x)) ?? [];
  return t.length ? t : ["default"];
}

function valueFor(entry: TokenEntry, theme: string, first: string): string | undefined {
  if (typeof entry.value === "string") return theme === first ? entry.value : undefined;
  if (entry.value && typeof entry.value === "object") return entry.value[theme];
  return undefined;
}

/** Checks aliases for cycles and depth; returns names of colour tokens that resolve. */
function resolvableColors(entries: TokenEntry[], themes: string[], warnings: string[]): Set<string> {
  const byName = new Map(entries.map((e) => [e.name.replace(/^(--|\.)/, ""), e]));
  const ok = new Set<string>();
  const check = (name: string, theme: string, depth: number, seen: Set<string>): boolean => {
    if (depth > 16 || seen.has(name)) return false;
    const e = byName.get(name);
    if (!e) return false;
    let v = valueFor(e, theme, themes[0]) ?? valueFor(e, themes[0], themes[0]);
    if (v === undefined) return false;
    const alias = ALIAS_RE.exec(v.trim());
    if (alias) return check(alias[1], theme, depth + 1, new Set([...seen, name]));
    return COLOR_RE.test(v.trim());
  };
  for (const e of entries) {
    const n = cleanName(e.name);
    if (!n) {
      warnings.push(`Colour token "${e.name}" has an invalid name and was dropped.`);
      continue;
    }
    if (themes.some((t) => check(n, t, 0, new Set()))) ok.add(n);
    else warnings.push(`Colour token "${n}" has no valid value (bad colour, missing alias or cycle) and was dropped.`);
  }
  return ok;
}

export function styleDeclarations(style: TypeStyle, familyKey: string | undefined, families: Record<string, string>): string[] {
  const decl: string[] = [];
  const fam = style.family ?? familyKey;
  if (fam && families[fam]) decl.push(`font-family: var(--font-${cssName(fam)})`);
  const fs = px(style.fontSize);
  if (fs) decl.push(`font-size: ${fs}`);
  const lh = lineHeight(style.lineHeight);
  if (lh) decl.push(`line-height: ${lh}`);
  const fw = weight(style.fontWeight);
  if (fw) decl.push(`font-weight: ${fw.split(/\s+/)[0]}`);
  if (style.fontStyle === "italic" || style.fontStyle === "normal") decl.push(`font-style: ${style.fontStyle}`);
  const ls = px(style.letterSpacing);
  if (ls) decl.push(`letter-spacing: ${ls}`);
  if (typeof style.opticalSize === "number") decl.push(`font-variation-settings: 'opsz' ${style.opticalSize}`);
  if (style.name === "label" || /capitals/i.test(style.usage ?? "")) decl.push("text-transform: uppercase");
  return decl;
}

export function compileTokensCss(tokens: TokensFile, opts: CompileOptions = {}): CompiledTokens {
  const warnings: string[] = [];
  const themes = themeIds(tokens);
  const first = themes[0];
  const out: string[] = [];

  // Fonts
  for (const f of tokens.type?.fonts ?? []) {
    if (!f.family || /["'<>{};]/.test(f.family)) {
      warnings.push(`Font entry with family "${f.family}" is invalid and was skipped.`);
      continue;
    }
    const file = f.file.includes("/") ? f.file : `fonts/${f.file}`;
    const src = opts.fontSrc ? opts.fontSrc(file) : file;
    if (!src) {
      warnings.push(`Font file "${file}" for ${f.family} is missing.`);
      continue;
    }
    const fmt = file.endsWith(".woff2") ? "woff2" : file.endsWith(".woff") ? "woff" : file.endsWith(".otf") ? "opentype" : "truetype";
    out.push(
      `@font-face { font-family: "${f.family}"; src: url("${src}") format("${fmt}"); font-weight: ${weight(f.weight) ?? "400"}; font-style: ${f.style ?? "normal"}; font-display: block; }`,
    );
  }

  // Colours (+ shadows) per theme
  const colorEntries = tokens.color?.tokens ?? [];
  const okColors = resolvableColors(colorEntries, themes, warnings);
  const shadowEntries = tokens.shadow?.tokens ?? [];
  for (const theme of themes) {
    const decl: string[] = [];
    for (const e of colorEntries) {
      const n = cleanName(e.name);
      if (!n || !okColors.has(n)) continue;
      let v = valueFor(e, theme, first);
      if (v === undefined && theme === first) v = valueFor(e, first, first);
      if (v === undefined) {
        if (theme === first) {
          // borrowed from a later theme
          const later = themes.map((t) => valueFor(e, t, first)).find((x) => x !== undefined);
          if (later) v = later;
        }
      }
      if (v === undefined) {
        // aliases are re-declared in every theme so they follow overrides
        if (theme !== first && typeof e.value === "string" && ALIAS_RE.test(e.value.trim())) v = e.value;
        else continue;
      }
      const cv = colorValue(v, okColors);
      if (cv) decl.push(`--${cssName(n)}: ${cv};`);
    }
    for (const e of shadowEntries) {
      const n = cleanName(e.name);
      if (!n) continue;
      const v = valueFor(e, theme, first);
      if (v && v.length <= 400 && !/var\(|url\(/i.test(v)) decl.push(`--${cssName(n)}: ${v};`);
    }
    if (!decl.length) continue;
    const sel = theme === first ? `:root, [data-theme="${first}"]` : `[data-theme="${theme}"]`;
    out.push(`${sel} {\n  ${decl.join("\n  ")}\n}`);
  }

  // Other families
  const rootDecl: string[] = [];
  const seen = new Set(okColors);
  for (const [key, fam] of Object.entries(tokens)) {
    if (KNOWN_FAMILIES.has(key) || !fam || typeof fam !== "object" || !Array.isArray((fam as { tokens?: unknown }).tokens)) continue;
    for (const e of (fam as { tokens: TokenEntry[] }).tokens) {
      const n = cleanName(e.name);
      if (!n || typeof e.value !== "string") continue;
      if (seen.has(n)) {
        warnings.push(`Token "${n}" duplicates another token name and was dropped.`);
        continue;
      }
      const v = e.value.trim();
      const valid = key === "spacing" || key === "radius" ? LENGTH_RE.test(v) || /^\d+$/.test(v) : PLAIN_VALUE_RE.test(v) && !/url\(|var\(/i.test(v);
      if (!valid) {
        warnings.push(`Token "${n}" in ${key} has an unsupported value "${v}" and was dropped.`);
        continue;
      }
      seen.add(n);
      rootDecl.push(`--${cssName(n)}: ${/^\d+$/.test(v) && v !== "0" ? v + "px" : v};`);
    }
  }
  const families = tokens.type?.families ?? {};
  for (const [k, stack] of Object.entries(families)) {
    if (!NAME_RE.test(k) || !FAMILY_RE.test(stack)) {
      warnings.push(`Font family "${k}" has an invalid stack and was dropped.`);
      continue;
    }
    rootDecl.push(`--font-${cssName(k.toLowerCase())}: ${stack};`);
  }
  if (rootDecl.length) out.push(`:root {\n  ${rootDecl.join("\n  ")}\n}`);

  // Type styles
  for (const g of tokens.type?.groups ?? []) {
    for (const s of g.styles ?? []) {
      const n = cleanName(s.name);
      if (!n || !px(s.fontSize)) {
        warnings.push(`Type style "${s.name}" has an invalid name or font size and was dropped.`);
        continue;
      }
      out.push(`.${cssName(n)} { ${styleDeclarations(s, g.family, families).join("; ")}; }`);
    }
  }

  return { css: out.join("\n"), themes, warnings };
}

/** Resolves a colour token to a literal colour for a theme, following aliases. */
export function resolveColor(tokens: TokensFile, name: string, theme?: string): string | null {
  const themes = themeIds(tokens);
  const t = theme && themes.includes(theme) ? theme : themes[0];
  const byName = new Map((tokens.color?.tokens ?? []).map((e) => [e.name.replace(/^(--|\.)/, ""), e]));
  let current = name;
  for (let i = 0; i < 17; i++) {
    const e = byName.get(current);
    if (!e) return null;
    const v = (valueFor(e, t, themes[0]) ?? valueFor(e, themes[0], themes[0]) ?? themes.map((x) => valueFor(e, x, themes[0])).find(Boolean))?.trim();
    if (!v) return null;
    const alias = ALIAS_RE.exec(v);
    if (!alias) return COLOR_RE.test(v) ? v.toLowerCase() : null;
    current = alias[1];
  }
  return null;
}

/** All literal (non-alias, opaque) colours in the palette — used for palette checks. */
export function paletteColors(tokens: TokensFile): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const e of tokens.color?.tokens ?? []) {
    if (typeof e.value !== "string") continue;
    const v = e.value.trim();
    if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) out.push({ name: e.name, value: v.toLowerCase() });
  }
  return out;
}

export function allTypeStyles(tokens: TokensFile): (TypeStyle & { group: string })[] {
  return (tokens.type?.groups ?? []).flatMap((g) => (g.styles ?? []).map((s) => ({ ...s, family: s.family ?? g.family, group: g.name })));
}
