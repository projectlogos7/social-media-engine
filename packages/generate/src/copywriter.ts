import type Anthropic from "@anthropic-ai/sdk";
import type { Slot, SlotValues } from "@sme/core";
import { callJson, DEFAULT_COPY_MODEL } from "./claude";

export interface BrandContext {
  name: string;
  readme: string;
  sections: { title: string; markdown: string }[];
  voice: string;
  extraVoice: string;
  bannedWords: string[];
  language: string;
  hashtags: string[];
  maxHashtags: number;
  imageStyle: string;
}

export interface KnowledgeSnippet {
  url: string;
  title: string;
  text: string;
}

export interface CopyTemplate {
  id: string;
  name: string;
  description: string;
  slots: Slot[];
  /** Existing values that must be kept verbatim. */
  fixed?: SlotValues;
}

export interface CopyVariant {
  slots: Record<string, string | string[]>;
  /** Image slot name -> subject description for the image model. */
  imagePrompts: Record<string, string>;
  caption: string;
  hashtags: string[];
  altText: string;
  sourceUrls: string[];
}

export interface CopyRequest {
  client: Anthropic;
  model?: string;
  brand: BrandContext;
  template: CopyTemplate;
  brief: string;
  knowledge: KnowledgeSnippet[];
  variants: number;
  platforms: string[];
  /** Pages of a carousel: each entry is one template; the copywriter fills them as one story. */
  validate: (v: CopyVariant) => string[];
  maxAttempts?: number;
}

export interface CopyResult {
  variants: CopyVariant[];
  model: string;
  attempts: number;
  problems: string[];
}

/** The stable brand system prompt. Same project, same bytes: prompt caching applies. */
export function brandSystemPrompt(b: BrandContext): string {
  const sections = b.sections
    .filter((s) => s.markdown.trim())
    .map((s) => `<section title="${s.title}">\n${s.markdown.trim()}\n</section>`)
    .join("\n\n");
  return `You write social media copy for ${b.name}. You fill the text slots of fixed, designed templates: the layout, fonts and colours are already decided, so you only choose words (and describe pictures for image slots).

Follow the brand book and voice exactly. Write in ${b.language}.

<brand_book>
${b.readme.trim()}

${sections}
</brand_book>

<voice>
${b.voice.trim() || "No separate voice section; follow the brand book."}
${b.extraVoice.trim()}
</voice>

Rules that are checked automatically after you answer:
- Every text slot stays within its character limit and line limit. Count characters; shorter is safer.
- Never use these words: ${b.bannedWords.length ? b.bannedWords.join(", ") : "(none listed)"}.
- Facts, figures, names, dates and quotations come only from the brief or the provided sources. Do not invent them. If a required fact is missing, write copy that does not depend on it.
- List every source URL you relied on in sourceUrls (only URLs that were provided).
- Image prompts describe the subject and composition only, in one or two sentences; the brand's visual style is added automatically: "${b.imageStyle || "(none)"}". No text, logos or lettering in images.
- Hashtags: at most ${b.maxHashtags}${b.hashtags.length ? `; prefer: ${b.hashtags.join(" ")}` : ""}.`;
}

function slotSchema(s: Slot): Record<string, unknown> {
  const limits = [s.maxChars ? `at most ${s.maxChars} characters` : "", s.maxLines ? `fits in ${s.maxLines} line(s)` : "", s.minChars ? `at least ${s.minChars} characters` : ""].filter(Boolean).join(", ");
  const desc = `${s.label}. ${s.description}${limits ? ` (${limits})` : ""}`;
  if (s.type === "list") return { type: "array", items: { type: "string" }, description: `${desc}${s.maxItems ? `; at most ${s.maxItems} items` : ""}` };
  if (s.type === "choice" && s.options?.length) return { type: "string", enum: s.options, description: desc };
  return { type: "string", description: desc };
}

export function copySchema(t: CopyTemplate): Record<string, unknown> {
  const textSlots = t.slots.filter((s) => s.type !== "image" && !s.fixed && !(t.fixed && s.name in t.fixed));
  const imageSlots = t.slots.filter((s) => s.type === "image");
  const variant = {
    type: "object",
    additionalProperties: false,
    required: ["slots", "imagePrompts", "caption", "hashtags", "altText", "sourceUrls"],
    properties: {
      slots: {
        type: "object",
        additionalProperties: false,
        required: textSlots.map((s) => s.name),
        properties: Object.fromEntries(textSlots.map((s) => [s.name, slotSchema(s)])),
      },
      imagePrompts: {
        type: "object",
        additionalProperties: false,
        required: imageSlots.map((s) => s.name),
        properties: Object.fromEntries(imageSlots.map((s) => [s.name, { type: "string", description: `Subject and composition for "${s.label}". ${s.description}` }])),
      },
      caption: { type: "string", description: "The post caption, in the brand voice." },
      hashtags: { type: "array", items: { type: "string" } },
      altText: { type: "string", description: "Alt text describing the finished image for screen readers." },
      sourceUrls: { type: "array", items: { type: "string" } },
    },
  };
  return { type: "object", additionalProperties: false, required: ["variants"], properties: { variants: { type: "array", items: variant } } };
}

function userPrompt(r: CopyRequest): string {
  const t = r.template;
  const slots = t.slots
    .map((s) => {
      const fixed = t.fixed?.[s.name];
      return `- ${s.name} (${s.type}${s.required ? ", required" : ", optional — use an empty string to leave it out"}): ${s.label}. ${s.description}${s.maxChars ? ` Max ${s.maxChars} characters.` : ""}${s.maxLines ? ` Max ${s.maxLines} lines.` : ""}${fixed !== undefined ? ` FIXED, do not include: ${JSON.stringify(fixed)}` : ""}`;
    })
    .join("\n");
  const sources = r.knowledge.length
    ? r.knowledge.map((k, i) => `<source index="${i + 1}" url="${k.url}" title="${k.title.replace(/"/g, "'")}">\n${k.text.slice(0, 6000)}\n</source>`).join("\n")
    : "(no sources provided)";
  return `Template: "${t.name}" — ${t.description}
Platforms: ${r.platforms.join(", ") || "instagram, linkedin"}

Slots:
${slots}

<sources>
${sources}
</sources>

<brief>
${r.brief.trim() || "(no brief: choose the strongest angle from the sources)"}
</brief>

Write ${r.variants} distinct variant(s). Make them genuinely different angles, not rewordings.`;
}

/**
 * Fills a template's slots. Output is schema-constrained JSON; every variant
 * is then validated (lengths, banned words, sources) and Claude is asked to
 * fix any problems, up to maxAttempts.
 */
export async function writeCopy(r: CopyRequest): Promise<CopyResult> {
  const system = brandSystemPrompt(r.brand);
  const schema = copySchema(r.template);
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: userPrompt(r) }];
  const maxAttempts = r.maxAttempts ?? 3;
  let last: CopyVariant[] = [];
  let problems: string[] = [];
  let model = r.model ?? DEFAULT_COPY_MODEL;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await callJson<{ variants: CopyVariant[] }>({ client: r.client, model: r.model, system, messages, schema });
    model = res.model;
    last = (res.data.variants ?? []).slice(0, Math.max(1, r.variants));
    const allowed = new Set(r.knowledge.map((k) => k.url));
    for (const v of last) v.sourceUrls = (v.sourceUrls ?? []).filter((u) => allowed.has(u));
    problems = last.flatMap((v, i) => r.validate(v).map((p) => `Variant ${i + 1}: ${p}`));
    if (!problems.length) return { variants: last, model, attempts: attempt, problems: [] };
    if (attempt < maxAttempts) {
      messages.push(res.assistant, {
        role: "user",
        content: `These problems were found by the automatic checks:\n${problems.map((p) => `- ${p}`).join("\n")}\n\nReturn all ${r.variants} variant(s) again with these fixed. Keep everything else the same.`,
      });
    }
  }
  return { variants: last, model, attempts: maxAttempts, problems };
}

export interface TemplateChoice {
  templateId: string;
  reason: string;
}

/** Picks the best template for a brief. */
export async function suggestTemplate(o: {
  client: Anthropic;
  model?: string;
  brand: BrandContext;
  brief: string;
  templates: { id: string; name: string; description: string; slots: string[]; formats: string[] }[];
}): Promise<TemplateChoice> {
  const res = await callJson<TemplateChoice>({
    client: o.client,
    model: o.model,
    effort: "low",
    maxTokens: 4000,
    system: brandSystemPrompt(o.brand),
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["templateId", "reason"],
      properties: { templateId: { type: "string", enum: o.templates.map((t) => t.id) }, reason: { type: "string" } },
    },
    messages: [
      {
        role: "user",
        content: `Pick the template that best fits this brief.\n\nTemplates:\n${o.templates.map((t) => `- ${t.id}: ${t.name} — ${t.description} (slots: ${t.slots.join(", ")}; formats: ${t.formats.join(", ")})`).join("\n")}\n\n<brief>\n${o.brief}\n</brief>`,
      },
    ],
  });
  return res.data;
}
