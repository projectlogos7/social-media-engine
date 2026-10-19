import { and, asc, desc, eq, max } from "drizzle-orm";
import { FORMATS, type FormatId, type QualityIssue, type SlotValues, type TemplateSpec, TemplateSpecSchema, isImageRef, sha256 } from "@sme/core";
import { componentToTemplate, lintTemplate, starterTemplates, type StarterChoice } from "@sme/design";
import { visualDiff } from "@sme/render";
import { contentKey, type DB, getStorage, projects, templates, templateVersions } from "@sme/db";
import { assertProject, type Actor } from "./access";
import { currentDsVersionId, loadDsRuntime, type DsRuntime } from "./designsystems";
import { EngineError, NotFound } from "./errors";
import { imageResolver } from "./assets";
import { getRenderer } from "./runtime";

export type TemplateVersion = typeof templateVersions.$inferSelect;

function parseSpec(spec: unknown): TemplateSpec {
  const r = TemplateSpecSchema.safeParse(spec);
  if (!r.success) throw new EngineError(`The template is not valid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const names = r.data.slots.map((s) => s.name);
  const dup = names.find((n, i) => names.indexOf(n) !== i);
  if (dup) throw new EngineError(`Two slots are named "${dup}".`);
  return r.data;
}

export function lintWith(rt: DsRuntime, spec: TemplateSpec): QualityIssue[] {
  const issues = lintTemplate(spec, { tokens: rt.tokens, assetPaths: rt.assetPaths, rules: rt.rules });
  if (spec.theme && !rt.themes.includes(spec.theme)) issues.push({ code: "lint", severity: "error", message: `Theme "${spec.theme}" does not exist; themes: ${rt.themes.join(", ")}.` });
  return issues;
}

/** Saves a template (new, or a new version of an existing one). Lint errors block saving. */
export async function saveTemplate(db: DB, actor: Actor, projectId: string, specIn: unknown, opts: { templateId?: string; note?: string } = {}) {
  await assertProject(db, actor, projectId, "template.manage");
  const spec = parseSpec(specIn);
  const dsVersionId = await currentDsVersionId(db, projectId);
  const rt = await loadDsRuntime(db, dsVersionId);
  const issues = lintWith(rt, spec);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) throw new EngineError(`Fix these before saving:\n${errors.map((e) => `• ${e.message}`).join("\n")}`, 400, issues);

  return db.transaction(async (tx) => {
    let templateId = opts.templateId;
    if (templateId) {
      const [t] = await tx.select().from(templates).where(and(eq(templates.id, templateId), eq(templates.projectId, projectId)));
      if (!t) throw new NotFound("Template");
    } else {
      const [t] = await tx.insert(templates).values({ projectId, name: spec.name, role: spec.role }).returning();
      templateId = t.id;
    }
    const [{ v }] = await tx.select({ v: max(templateVersions.version) }).from(templateVersions).where(eq(templateVersions.templateId, templateId));
    const [version] = await tx
      .insert(templateVersions)
      .values({ templateId, version: (v ?? 0) + 1, spec, designSystemVersionId: dsVersionId, note: opts.note ?? "", createdBy: actor.userId })
      .returning();
    await tx.update(templates).set({ name: spec.name, role: spec.role, currentVersionId: version.id }).where(eq(templates.id, templateId));
    return { templateId, version, warnings: issues };
  });
}

export async function listTemplates(db: DB, actor: Actor, projectId: string, opts: { includeArchived?: boolean } = {}) {
  await assertProject(db, actor, projectId, "view");
  const rows = await db
    .select({ t: templates, v: templateVersions })
    .from(templates)
    .leftJoin(templateVersions, eq(templateVersions.id, templates.currentVersionId))
    .where(and(eq(templates.projectId, projectId), opts.includeArchived ? undefined : eq(templates.archived, false)))
    .orderBy(asc(templates.name));
  return rows.map(({ t, v }) => ({ ...t, version: v?.version ?? 0, versionId: v?.id ?? null, spec: v?.spec as TemplateSpec | undefined }));
}

export async function getTemplate(db: DB, actor: Actor, templateId: string) {
  const [t] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!t) throw new NotFound("Template");
  await assertProject(db, actor, t.projectId, "view");
  const versions = await db.select().from(templateVersions).where(eq(templateVersions.templateId, templateId)).orderBy(desc(templateVersions.version));
  const current = versions.find((v) => v.id === t.currentVersionId) ?? versions[0];
  return { template: t, current: { ...current, spec: current.spec as TemplateSpec }, versions };
}

export async function getTemplateVersion(db: DB, versionId: string) {
  const [v] = await db.select().from(templateVersions).where(eq(templateVersions.id, versionId));
  if (!v) throw new NotFound("Template version");
  const [t] = await db.select().from(templates).where(eq(templates.id, v.templateId));
  return { version: { ...v, spec: v.spec as TemplateSpec }, template: t };
}

export async function setTemplateArchived(db: DB, actor: Actor, templateId: string, archived: boolean) {
  const [t] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!t) throw new NotFound("Template");
  await assertProject(db, actor, t.projectId, "template.manage");
  await db.update(templates).set({ archived }).where(eq(templates.id, templateId));
}

/** Renders a template that is not saved yet (editor preview). */
export async function previewTemplate(db: DB, actor: Actor, projectId: string, specIn: unknown, format: FormatId, slots?: SlotValues) {
  await assertProject(db, actor, projectId, "view");
  const spec = parseSpec(specIn);
  const rt = await loadDsRuntime(db, await currentDsVersionId(db, projectId));
  const lint = lintWith(rt, spec);
  const values = slots ?? (spec.sample as SlotValues);
  const imageUrl = await imageResolver(db, projectId, Object.values(values).filter(isImageRef).map((v) => v.assetId));
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  const renderer = await getRenderer();
  const res = await renderer.render({
    tokensCss: rt.tokensCss,
    theme: spec.theme || rt.themes[0],
    format: FORMATS[format],
    template: spec,
    slots: values,
    assetUrl: rt.assetUrl,
    imageUrl,
    rules: rt.rules,
    page: spec.role === "content" ? { index: 1, count: 3 } : undefined,
    vars: { project: p?.name, handle: p?.handle },
  });
  return { png: res.png, report: res.report, lint };
}

/** Renders the sample for every format and stores it as the template version's golden snapshot. */
export async function setGolden(db: DB, actor: Actor, templateVersionId: string) {
  const { version, template } = await getTemplateVersion(db, templateVersionId);
  await assertProject(db, actor, template.projectId, "template.manage");
  const golden: Record<string, string> = {};
  for (const f of version.spec.formats) {
    const r = await previewTemplate(db, actor, template.projectId, version.spec, f);
    const key = contentKey(`p/${template.projectId}/golden`, sha256(r.png), "image/png");
    await getStorage().put(key, r.png, "image/png");
    golden[f] = key;
  }
  await db.update(templateVersions).set({ golden }).where(eq(templateVersions.id, templateVersionId));
  return golden;
}

/** Compares a spec (e.g. an edit, or the current design system) against the golden snapshots. */
export async function compareToGolden(db: DB, actor: Actor, templateVersionId: string, specIn?: unknown) {
  const { version, template } = await getTemplateVersion(db, templateVersionId);
  const spec = specIn ? parseSpec(specIn) : version.spec;
  const out: { format: string; ratio: number; diffPixels: number; before: Buffer; after: Buffer; diff: Buffer }[] = [];
  for (const [format, key] of Object.entries(version.golden as Record<string, string>)) {
    if (!spec.formats.includes(format as FormatId)) continue;
    const before = await getStorage().get(key);
    const after = (await previewTemplate(db, actor, template.projectId, spec, format as FormatId)).png;
    const d = visualDiff(before, after);
    out.push({ format, ratio: d.ratio, diffPixels: d.diffPixels, before, after, diff: d.diffPng });
  }
  return out;
}

export async function createTemplateFromComponent(db: DB, actor: Actor, projectId: string, componentName: string, format: FormatId = "square") {
  const rt = await loadDsRuntime(db, await currentDsVersionId(db, projectId));
  const comp = rt.components.find((c) => c.name === componentName);
  if (!comp) throw new NotFound("Component");
  const spec = componentToTemplate(comp, format);
  if (!spec) throw new EngineError("This component has no preview to convert.");
  return saveTemplate(db, actor, projectId, spec, { note: `Converted from the ${componentName} showcase` });
}

export async function createStarterKit(db: DB, actor: Actor, projectId: string, choice: StarterChoice) {
  const created = [];
  for (const spec of starterTemplates(choice)) created.push(await saveTemplate(db, actor, projectId, spec, { note: "Starter kit" }));
  return created;
}
