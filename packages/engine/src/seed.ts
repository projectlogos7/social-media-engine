import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { readDirectory, importFromFiles } from "@sme/design";
import { type DB, projects, users } from "@sme/db";
import { createSession, signUp } from "./auth";
import { publishDesignSystemVersion, saveDesignSystemVersion } from "./designsystems";
import { createProject, updateProject } from "./projects";
import { saveTemplate, setGolden } from "./templates";
import { createPost, renderPostInternal } from "./posts";
import { ISMII_TEMPLATES } from "./fixtures/ismii-templates";

export const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../fixtures");

/**
 * Demo data: an owner account, a workspace and the ISMII project with its
 * design system imported and published, the ISMII templates (with golden
 * snapshots) and two sample posts. Safe to run twice.
 */
export async function seed(db: DB, opts: { email?: string; password?: string; name?: string } = {}) {
  const email = (opts.email ?? process.env.SEED_EMAIL ?? "owner@example.com").toLowerCase();
  const password = opts.password ?? process.env.SEED_PASSWORD ?? "change-me-now";
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return { created: false, email };

  const { user, workspace } = await signUp(db, { email, name: opts.name ?? "Owner", password, workspaceName: "Nous" });
  const actor = { userId: user.id, workspaceId: workspace.id };
  const project = await createProject(db, actor, { name: "ISMII", handle: "@ismii" });
  const bundle = importFromFiles(await readDirectory(resolve(FIXTURES_DIR, "ismii")));
  const version = await saveDesignSystemVersion(db, actor, project.id, bundle, "Imported from the ISMII Claude design system");
  await publishDesignSystemVersion(db, actor, version.id);
  await updateProject(db, actor, project.id, {
    settings: {
      imagery: {
        provider: "placeholder",
        model: "",
        stylePrompt: "documentary photograph, natural light, real places and real documents, Indo-Islamic architecture, warm sandstone and marble tones, no heavy filters",
        negativePrompt: "text, lettering, logos, watermark, staged stock photo, heavy filter, people posing",
        referenceAssetIds: [],
        candidates: 4,
        paletteTolerance: 28,
      },
      voice: { bannedWords: ["CSII", "CSIMI", "—"], extra: "", hashtags: ["#ISMII"], maxHashtags: 3, language: "English" },
    },
  });

  const saved: Record<string, string> = {};
  for (const spec of ISMII_TEMPLATES) {
    const r = await saveTemplate(db, actor, project.id, spec, { note: "ISMII seed template" });
    saved[spec.name] = r.version.id;
    await setGolden(db, actor, r.version.id);
  }

  const lecture = await createPost(db, actor, project.id, {
    title: "Coast before conquest",
    pages: [{ templateVersionId: saved["Lecture announcement"], slots: ISMII_TEMPLATES[0].sample as never }],
    formats: ["square", "story", "landscape"],
    caption: "Join us for the ISMII Lecture on the Malabar coast and the merchants who brought Islam to India long before any sultanate.",
    hashtags: ["#ISMII"],
    altText: "ISMII Lecture announcement on a sandstone background.",
  });
  await renderPostInternal(db, lecture.id, { createdBy: user.id });
  const carousel = await createPost(db, actor, project.id, {
    title: "Five ports that brought Islam to India",
    pages: [
      { templateVersionId: saved["Carousel cover"], slots: ISMII_TEMPLATES[5].sample as never },
      { templateVersionId: saved["Carousel page"], slots: ISMII_TEMPLATES[6].sample as never },
      { templateVersionId: saved["Carousel page"], slots: { title: "Quilon", text: "Copper plates from the ninth century record the rights granted to a merchant guild, among them Muslim traders." } },
      { templateVersionId: saved["Carousel end"], slots: ISMII_TEMPLATES[7].sample as never },
    ],
    formats: ["portrait"],
    caption: "Before conquest there was commerce. Five ports where Islam first arrived in India.",
    hashtags: ["#ISMII"],
    altText: "Carousel: five ports that brought Islam to India.",
  });
  await renderPostInternal(db, carousel.id, { createdBy: user.id });
  const session = await createSession(db, user.id, workspace.id);
  const [p] = await db.select().from(projects).where(eq(projects.id, project.id));
  return { created: true, email, password, projectId: p.id, workspaceId: workspace.id, userId: user.id, sessionToken: session.token };
}
