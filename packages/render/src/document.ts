import type { Format, SlotValues, TemplateSpec } from "@sme/core";
import { compileTemplate } from "@sme/design";

export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body { -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; caret-color: transparent; }
.canvas { position: relative; overflow: hidden; background: var(--ground, transparent); color: var(--text, inherit); }
`;

export interface DocumentInput {
  tokensCss: string;
  theme: string;
  format: Format;
  template: Pick<TemplateSpec, "html" | "css">;
  slots: SlotValues;
  assetUrl: (path: string) => string | null;
  imageUrl: (assetId: string) => string | null;
  page?: { index: number; count: number };
  vars?: Record<string, unknown>;
}

export function buildDocument(input: DocumentInput): { html: string; missing: string[] } {
  const { html, css, missing } = compileTemplate(input.template, {
    format: input.format,
    slots: input.slots,
    assetUrl: input.assetUrl,
    imageUrl: input.imageUrl,
    page: input.page,
    vars: input.vars,
  });
  const theme = input.theme.replace(/[^a-z0-9_-]/gi, "");
  const doc = `<!doctype html>
<html lang="en"${theme ? ` data-theme="${theme}"` : ""}>
<head><meta charset="utf-8">
<style>${input.tokensCss}</style>
<style>${BASE_CSS}</style>
<style>${css}</style>
</head>
<body><div class="canvas" data-format="${input.format.id}" style="width:${input.format.width}px;height:${input.format.height}px">
${html}
</div></body></html>`;
  return { html: doc, missing };
}
