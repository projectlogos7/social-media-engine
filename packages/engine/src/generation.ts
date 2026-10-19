import type Anthropic from "@anthropic-ai/sdk";
import { and, eq, inArray } from "drizzle-orm";
import { FORMATS, type FormatId, type ImageGenerationRecord, type ImageRef, type Slot, type SlotValues, type TemplateSpec } from "@sme/core";
import { anthropicClient, composePrompt, type CopyVariant, fitImage, getImageProvider, type KnowledgeSnippet, seedFrom, suggestTemplate, writeCopy } from "@sme/generate";
import { paletteReport } from "@sme/render";
import { type DB, assets, getStorage, templates, templateVersions, webPages } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { brandContext, projectWithSettings } from "./brand";
import { currentDsVersionId, loadDsRuntime } from "./designsystems";
import { EngineError, NotFound } from "./errors";
import { getProviderKey } from "./keys";
import { searchKnowledge } from "./knowledge";
import { createPost, renderPostInternal } from "./posts";
import { storeImage } from "./assets";
import { getRenderer } from "./runtime";

export interface GenerateRequest {
  projectId: string;
  /** A template id, or "auto" to let Claude choose. Ignored for carousels. */
  templateId?: string;
  carousel?: { coverTemplateId: string; contentTemplateId: string; endTemplateId?: string; pages: number };
  brief: string;
  formats: FormatId[];
  variants: number;
  sourcePageIds?: string[];
  /** Search the website knowledge for this query when no pages are given. */
  knowledgeQuery?: string;
  images: "generate" | "library" | "none";
  libraryAssetIds?: string[];
  batchId?: string | null;
  /** Used for stable image seeds. */
  runId?: string;
}

export interface GenerateDeps {
  anthropic?: Anthropic;
  progress?: (msg: string) => void | Promise<void>;
}

interface PageTemplate {
  versionId: string;
  templateId: string;
  spec: TemplateSpec;
  prefix: string;
}

async function currentVersion(db: DB, projectId: string, templateId: string): Promise<PageTemplate> {
  const [row] = await db
    .select({ t: templates, v: templateVersions })
    .from(templates)
    .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)));
  if (!row) throw new NotFound("Template");
  return { versionId: row.v.id, templateId: row.t.id, spec: row.v.spec as TemplateSpec, prefix: "" };
}

async function loadKnowledge(db: DB, actor: Actor, req: GenerateRequest): Promise<KnowledgeSnippet[]> {
  if (req.sourcePageIds?.length) {
    const rows = await db.select().from(webPages).where(and(eq(webPages.projectId, req.projectId), inArray(webPages.id, req.sourcePageIds)));
    return rows.map((r) => ({ url: r.url, title: r.title, text: [r.description, r.text].filter(Boolean).join("\n\n") }));
  }
  const q = req.knowledgeQuery?.trim();
  if (!q) return [];
  const hits = await searchKnowledge(db, actor, req.projectId, q, 12);
  const byPage = new Map<string, KnowledgeSnippet>();
  for (const h of hits) {
    const k = byPage.get(h.url) ?? { url: h.url, title: h.title, text: "" };
    k.text += (k.text ? "\n\n" : "") + h.text;
    byPage.set(h.url, k);
  }
  return [...byPage.values()].slice(0, 5);
}

/** Splits a composite (prefixed) variant back into per-page slot values. */
function pageSlots(page: PageTemplate, v: CopyVariant): SlotValues {
  const out: SlotValues = {};
  for (const s of page.spec.slots) {
    if (s.type === "image") continue;
    if (s.fixed && page.spec.sample[s.name] !== undefined) {
      out[s.name] = page.spec.sample[s.name] as string;
      continue;
    }
    const val = v.slots[`${page.prefix}${s.name}`];
    if (val !== undefined) out[s.name] = Array.isArray(val) ? val : String(val);
  }
  return out;
}

/**
 * Generates post variants from a brief: Claude fills the slots (checked by
 * real test renders), images come from the project's provider with stored
 * seeds, and every variant is saved as a draft post and rendered.
 */
export async function generatePosts(db: DB, actor: Actor, req: GenerateRequest, deps: GenerateDeps = {}) {
  await assertProject(db, actor, req.projectId, "post.create");
  const progress = deps.progress ?? (() => {});
  const project = await projectWithSettings(db, req.projectId);
  const dsVersionId = await currentDsVersionId(db, req.projectId);
  const rt = await loadDsRuntime(db, dsVersionId);
  const brand = brandContext(rt, project.settings, project.name);
  if (!req.formats.length) throw new EngineError("Choose at least one format.");
  const variants = Math.min(Math.max(req.variants || 1, 1), 6);

  let client = deps.anthropic;
  if (!client) {
    const key = await getProviderKey(db, actor.workspaceId, "anthropic");
    if (!key && !process.env.ANTHROPIC_AUTH_TOKEN) throw new EngineError("Add an Anthropic API key in Settings → API keys to generate copy.");
    client = anthropicClient(key);
  }

  await progress("Reading sources");
  const knowledge = await loadKnowledge(db, actor, req);

  // Which template(s)
  let pages: PageTemplate[];
  let templateReason = "";
  if (req.carousel) {
    const n = Math.min(Math.max(req.carousel.pages, 2), 10);
    const cover = await currentVersion(db, req.projectId, req.carousel.coverTemplateId);
    const content = await currentVersion(db, req.projectId, req.carousel.contentTemplateId);
    const end = req.carousel.endTemplateId ? await currentVersion(db, req.projectId, req.carousel.endTemplateId) : null;
    const contentCount = n - 1 - (end ? 1 : 0);
    pages = [cover, ...Array.from({ length: Math.max(contentCount, 0) }, () => ({ ...content })), ...(end ? [end] : [])].map((p, i) => ({ ...p, prefix: `p${i + 1}_` }));
  } else {
    let templateId = req.templateId;
    if (!templateId || templateId === "auto") {
      const list = await db
        .select({ t: templates, v: templateVersions })
        .from(templates)
        .innerJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
        .where(and(eq(templates.projectId, req.projectId), eq(templates.archived, false)));
      const options = list.filter(({ v }) => {
        const s = v.spec as TemplateSpec;
        return s.role === "single" && req.formats.every((f) => s.formats.includes(f));
      });
      if (!options.length) throw new EngineError("No template supports all the chosen formats.");
      if (options.length === 1) templateId = options[0].t.id;
      else {
        await progress("Choosing a template");
        const choice = await suggestTemplate({
          client,
          model: project.settings.copyModel,
          brand,
          brief: `${req.brief}\n\n${knowledge.map((k) => k.title).join("\n")}`,
          templates: options.map(({ t, v }) => {
            const s = v.spec as TemplateSpec;
            return { id: t.id, name: s.name, description: s.description, slots: s.slots.map((x) => x.name), formats: s.formats };
          }),
        });
        templateId = choice.templateId;
        templateReason = choice.reason;
      }
    }
    pages = [await currentVersion(db, req.projectId, templateId)];
  }
  for (const p of pages) {
    const missing = req.formats.filter((f) => !p.spec.formats.includes(f));
    if (missing.length) throw new EngineError(`"${p.spec.name}" does not support ${missing.join(", ")}.`);
  }

  // Composite template the copywriter fills in one go (carousels are one story).
  const compositeSlots: Slot[] = pages.flatMap((p, i) =>
    p.spec.slots
      .filter((s) => !(s.fixed && p.spec.sample[s.name] !== undefined))
      .map((s) => ({ ...s, name: `${p.prefix}${s.name}`, label: pages.length > 1 ? `Page ${i + 1} ${s.label}` : s.label, description: `${pages.length > 1 ? `[${i === 0 ? "cover" : p.spec.role === "end" ? "closing page" : `page ${i + 1}`}] ` : ""}${s.description}` })),
  );
  const renderer = await getRenderer();
  const validate = async (v: CopyVariant): Promise<string[]> => {
    const problems: string[] = [];
    for (const page of pages) {
      const slots = pageSlots(page, v);
      for (const format of req.formats) {
        const res = await renderer.render({
          tokensCss: rt.tokensCss,
          theme: page.spec.theme || rt.themes[0],
          format: FORMATS[format],
          template: page.spec,
          slots,
          assetUrl: rt.assetUrl,
          imageUrl: () => null,
          rules: rt.rules,
          bannedWords: project.settings.voice.bannedWords,
          page: pages.length > 1 ? { index: pages.indexOf(page) + 1, count: pages.length } : undefined,
          vars: { project: project.name, handle: project.handle },
        });
        for (const i of res.report.issues) {
          if (i.severity !== "error" || i.code === "image_missing" || i.code === "logo_missing") continue;
          const where = pages.length > 1 ? `page ${pages.indexOf(page) + 1}, ` : "";
          problems.push(`${where}${FORMATS[format].label.split(" ·")[0]}: ${i.message}${i.slot ? ` (slot ${page.prefix}${i.slot})` : ""}`);
        }
      }
    }
    if (v.hashtags.length > project.settings.voice.maxHashtags) problems.push(`Use at most ${project.settings.voice.maxHashtags} hashtags.`);
    return [...new Set(problems)];
  };

  await progress(`Writing ${variants} variant${variants > 1 ? "s" : ""}`);
  const copy = await writeCopy({
    client,
    model: project.settings.copyModel,
    brand,
    template: { id: pages[0].templateId, name: pages.length > 1 ? `${pages.length}-page carousel` : pages[0].spec.name, description: pages.map((p) => p.spec.description).join(" / "), slots: compositeSlots },
    brief: req.brief,
    knowledge,
    variants,
    platforms: [...new Set(req.formats.flatMap((f) => FORMATS[f].platforms))],
    validate,
  });

  const imagery = project.settings.imagery;
  const runId = req.runId ?? `${Date.now()}`;
  const postIds: string[] = [];
  for (const [vi, v] of copy.variants.entries()) {
    const candidates: Record<string, string[]> = {};
    const pageValues: SlotValues[] = pages.map((p) => pageSlots(p, v));
    let libraryCursor = 0;
    for (const [pi, page] of pages.entries()) {
      for (const slot of page.spec.slots.filter((s) => s.type === "image")) {
        const key = `${page.prefix}${slot.name}`;
        if (req.images === "library" && req.libraryAssetIds?.length) {
          const id = req.libraryAssetIds[libraryCursor++ % req.libraryAssetIds.length];
          pageValues[pi][slot.name] = { kind: "image", assetId: id } satisfies ImageRef;
          continue;
        }
        if (req.images !== "generate" || slot.imageSource === "library") continue;
        await progress(`Generating images for variant ${vi + 1}`);
        const provider = getImageProvider(imagery.provider);
        const apiKey = provider.needsKey ? await getProviderKey(db, actor.workspaceId, provider.id) : undefined;
        const target = FORMATS[req.formats[0]];
        const seed = seedFrom(`${runId}:${vi}:${key}`);
        const refs = imagery.referenceAssetIds.length && provider.supportsReferences
          ? await Promise.all((await db.select().from(assets).where(and(eq(assets.projectId, req.projectId), inArray(assets.id, imagery.referenceAssetIds)))).map((a) => getStorage().get(a.storageKey)))
          : undefined;
        const prompt = composePrompt(imagery.stylePrompt, v.imagePrompts[key] ?? req.brief);
        const result = await provider.generate(
          { prompt, negativePrompt: imagery.negativePrompt || undefined, width: target.width, height: target.height, seed, n: imagery.candidates, model: imagery.model || undefined, references: refs, palette: rt.palette },
          apiKey,
        );
        const stored = [];
        for (const img of result.images) {
          const fitted = await fitImage(img.bytes, target.width, target.height);
          const pal = await paletteReport(fitted, rt.palette);
          const record: ImageGenerationRecord = {
            provider: provider.id, model: result.model, prompt, negativePrompt: imagery.negativePrompt || undefined, seed: img.seed, width: target.width, height: target.height,
            referenceAssetIds: refs ? imagery.referenceAssetIds : undefined, params: { notes: result.notes },
          };
          stored.push(await storeImage(db, req.projectId, fitted, { kind: "generated", name: v.imagePrompts[key]?.slice(0, 80) ?? slot.label, generation: record, paletteDistance: pal.distance, approved: false, createdBy: actor.userId }));
        }
        // Deterministic pick: the candidate closest to the brand palette.
        stored.sort((a, b) => (a.paletteDistance ?? 0) - (b.paletteDistance ?? 0));
        candidates[key] = stored.map((s) => s.id);
        if (stored[0]) pageValues[pi][slot.name] = { kind: "image", assetId: stored[0].id } satisfies ImageRef;
      }
    }
    const post = await createPost(db, actor, req.projectId, {
      pages: pages.map((p, i) => ({ templateVersionId: p.versionId, slots: pageValues[i] })),
      formats: req.formats,
      brief: req.brief,
      caption: v.caption,
      hashtags: v.hashtags.slice(0, project.settings.voice.maxHashtags),
      altText: v.altText,
      sourceUrls: v.sourceUrls,
      batchId: req.batchId ?? null,
      copyMeta: { model: copy.model, attempts: copy.attempts, problems: copy.problems, imagePrompts: v.imagePrompts, candidates, templateReason, variant: vi + 1, of: copy.variants.length },
    });
    await progress(`Rendering variant ${vi + 1}`);
    await renderPostInternal(db, post.id, { createdBy: actor.userId });
    postIds.push(post.id);
  }
  return { postIds, problems: copy.problems, attempts: copy.attempts, templateReason };
}

/** Swaps an image slot to another candidate (or any library image) and re-renders. */
export async function chooseImage(db: DB, actor: Actor, postId: string, pageId: string, slot: string, assetId: string) {
  const { getPost, updatePost } = await import("./posts");
  const p = await getPost(db, actor, postId);
  const page = p.pages.find((x) => x.id === pageId);
  if (!page) throw new NotFound("Page");
  const [a] = await db.select().from(assets).where(and(eq(assets.id, assetId), eq(assets.projectId, p.post.projectId)));
  if (!a) throw new NotFound("Image");
  await updatePost(db, actor, postId, { pages: [{ id: pageId, slots: { ...page.slots, [slot]: { kind: "image", assetId } } }] });
  await db.update(assets).set({ approved: true }).where(eq(assets.id, assetId));
  return renderPostInternal(db, postId, { createdBy: actor.userId });
}
