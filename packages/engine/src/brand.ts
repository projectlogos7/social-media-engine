import { eq } from "drizzle-orm";
import { ProjectSettingsSchema, type ProjectSettings } from "@sme/core";
import type { BrandContext } from "@sme/generate";
import { type DB, projects } from "@sme/db";
import type { DsRuntime } from "./designsystems";
import { NotFound } from "./errors";

export async function projectWithSettings(db: DB, projectId: string) {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) throw new NotFound("Project");
  return { ...p, settings: ProjectSettingsSchema.parse(p.settings ?? {}) as ProjectSettings };
}

/** Brand context for the copywriter: the design system's brand book and voice + project voice settings. */
export function brandContext(rt: DsRuntime, settings: ProjectSettings, projectName: string): BrandContext {
  const v = rt.version;
  const sections = (v.sections as { title: string; markdown: string; path: string }[]) ?? [];
  return {
    name: v.name || projectName,
    readme: v.readme,
    sections: sections.filter((s) => !/voice/i.test(s.title)).map((s) => ({ title: s.title, markdown: s.markdown })),
    voice: v.voice,
    extraVoice: settings.voice.extra,
    bannedWords: settings.voice.bannedWords,
    language: settings.voice.language,
    hashtags: settings.voice.hashtags,
    maxHashtags: settings.voice.maxHashtags,
    imageStyle: settings.imagery.stylePrompt,
  };
}
