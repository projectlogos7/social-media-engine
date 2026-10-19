export type Platform = "instagram" | "linkedin" | "youtube";

export interface Format {
  id: FormatId;
  label: string;
  width: number;
  height: number;
  platforms: Platform[];
  /** Pixels at the bottom kept clear of content (platform UI). */
  safeBottom: number;
  /** Pixels at the top kept clear of content (platform UI). */
  safeTop: number;
}

export const FORMAT_IDS = ["square", "portrait", "story", "landscape", "youtube"] as const;
export type FormatId = (typeof FORMAT_IDS)[number];

export const FORMATS: Record<FormatId, Format> = {
  square: { id: "square", label: "Square post · 1080 × 1080", width: 1080, height: 1080, platforms: ["instagram", "linkedin"], safeBottom: 0, safeTop: 0 },
  portrait: { id: "portrait", label: "Portrait post 4:5 · 1080 × 1350", width: 1080, height: 1350, platforms: ["instagram", "linkedin"], safeBottom: 0, safeTop: 0 },
  story: { id: "story", label: "Story / Reel cover 9:16 · 1080 × 1920", width: 1080, height: 1920, platforms: ["instagram"], safeBottom: 300, safeTop: 220 },
  landscape: { id: "landscape", label: "LinkedIn landscape · 1200 × 627", width: 1200, height: 627, platforms: ["linkedin"], safeBottom: 0, safeTop: 0 },
  youtube: { id: "youtube", label: "YouTube thumbnail · 1280 × 720", width: 1280, height: 720, platforms: ["youtube"], safeBottom: 0, safeTop: 0 },
};

export function getFormat(id: string): Format {
  const f = FORMATS[id as FormatId];
  if (!f) throw new Error(`Unknown format "${id}"`);
  return f;
}

/** Formats a platform accepts for single-image posts and carousels. */
export const PLATFORM_FORMATS: Record<Platform, { single: FormatId[]; carousel: FormatId[] }> = {
  instagram: { single: ["square", "portrait", "story"], carousel: ["square", "portrait"] },
  linkedin: { single: ["square", "portrait", "landscape"], carousel: ["square", "portrait"] },
  youtube: { single: ["youtube"], carousel: [] },
};
