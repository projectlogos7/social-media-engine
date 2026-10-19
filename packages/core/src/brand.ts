import { z } from "zod";

export const ImageryStyleSchema = z.object({
  provider: z.string().default("placeholder"),
  model: z.string().default(""),
  /** Prepended to every image prompt for this project. */
  stylePrompt: z.string().default(""),
  negativePrompt: z.string().default(""),
  referenceAssetIds: z.array(z.string()).default([]),
  candidates: z.number().int().min(1).max(8).default(4),
  /** Max average colour distance (CIEDE2000) from the brand palette before a warning. */
  paletteTolerance: z.number().default(28),
});
export type ImageryStyle = z.infer<typeof ImageryStyleSchema>;

export const VoiceRulesSchema = z.object({
  bannedWords: z.array(z.string()).default([]),
  /** Extra instructions on top of the design system's voice section. */
  extra: z.string().default(""),
  hashtags: z.array(z.string()).default([]),
  maxHashtags: z.number().int().min(0).max(30).default(5),
  language: z.string().default("English"),
});
export type VoiceRules = z.infer<typeof VoiceRulesSchema>;

export const ProjectSettingsSchema = z.object({
  imagery: ImageryStyleSchema.default(ImageryStyleSchema.parse({})),
  voice: VoiceRulesSchema.default(VoiceRulesSchema.parse({})),
  copyModel: z.string().default("claude-opus-5-5"),
});
export type ProjectSettings = z.infer<typeof ProjectSettingsSchema>;
