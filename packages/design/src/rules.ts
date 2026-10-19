import type { TokensFile } from "@sme/core";
import { paletteColors } from "./tokens-css";

/** Machine-checkable rules read from the colour tokens' usage notes. */
export interface BrandRules {
  /** Colours (hex) that must never set text. */
  neverText: { token: string; hex: string }[];
  /** Colours (hex) that may set text only at or above a size. */
  minTextPx: { token: string; hex: string; px: number }[];
  /** Text colour / ground pairs that are forbidden. */
  forbiddenPairs: { fg: string; bg: string; fgHex: string; bgHex: string }[];
}

export function deriveBrandRules(tokens: TokensFile): BrandRules {
  const palette = new Map(paletteColors(tokens).map((c) => [c.name, c.value]));
  const rules: BrandRules = { neverText: [], minTextPx: [], forbiddenPairs: [] };
  for (const e of tokens.color?.tokens ?? []) {
    const hex = palette.get(e.name);
    const usage = e.usage ?? "";
    if (!hex || !usage) continue;
    if (/never(?: set)? text(?! on)|never (?:as|for) text|not for text|only,? never text/i.test(usage)) rules.neverText.push({ token: e.name, hex });
    const min = /display text (\d+)\s*px and up only/i.exec(usage) ?? /text (\d+)\s*px and up only/i.exec(usage);
    if (min) rules.minTextPx.push({ token: e.name, hex, px: Number(min[1]) });
    const re = /never (?:set )?text on ([a-z0-9][a-z0-9_.-]*)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(usage))) {
      const bgHex = palette.get(m[1]);
      if (bgHex) rules.forbiddenPairs.push({ fg: e.name, bg: m[1], fgHex: hex, bgHex });
    }
  }
  return rules;
}
