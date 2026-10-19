import "server-only";
import type { TokensFile, TemplateSpec } from "@sme/core";
import { getDb } from "@sme/db";
import { getDesignSystemVersion, getProject, type Actor } from "@sme/engine";
import { themeIds } from "@sme/design";

/** What the template editor needs to know about the project's current design system. */
export async function dsSummary(actor: Actor, projectId: string) {
  const p = await getProject(getDb(), actor, projectId);
  if (!p.currentDesignSystemVersionId) return null;
  const v = await getDesignSystemVersion(getDb(), actor, p.currentDesignSystemVersionId);
  const tokens = v.tokens as TokensFile;
  return {
    versionId: v.id,
    name: v.name,
    version: v.version,
    themes: themeIds(tokens),
    colors: (tokens.color?.tokens ?? []).map((t) => ({ name: t.name, value: typeof t.value === "string" ? t.value : JSON.stringify(t.value), usage: t.usage ?? "" })),
    families: Object.keys(tokens.type?.families ?? {}),
    spacing: ((tokens.spacing as { tokens?: { name: string; value: string }[] })?.tokens ?? []).map((t) => `${t.name}: ${t.value}`),
    assets: v.files.filter((f) => f.kind === "asset").map((f) => ({ path: f.path.replace(/^assets\//, ""), contentType: f.contentType })),
    components: ((v.components as { name: string; previewHtml?: string }[]) ?? []).filter((c) => c.previewHtml).map((c) => c.name),
  };
}

export type DsSummary = NonNullable<Awaited<ReturnType<typeof dsSummary>>>;

export const BLANK_TEMPLATE: TemplateSpec = {
  name: "New template",
  description: "",
  formats: ["square"],
  theme: "",
  role: "single",
  html: `<div class="frame">\n  <h1 class="headline" data-slot="headline">{{headline}}</h1>\n</div>`,
  css: `.frame { position: absolute; inset: 0; padding: 96px; background: var(--ground); }\n.headline { font-family: var(--font-serif); font-size: 88px; line-height: 1.05; color: var(--text); margin: 0; }`,
  slots: [{ name: "headline", label: "Headline", type: "text", description: "The main statement.", required: true, maxChars: 80, maxLines: 4 }],
  sample: { headline: "A headline that says one thing well" },
};
