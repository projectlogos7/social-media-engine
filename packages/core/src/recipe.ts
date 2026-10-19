import type { FormatId } from "./formats";
import type { SlotValues } from "./template";

export const ENGINE_VERSION = "1";

export interface ImageGenerationRecord {
  provider: string;
  model: string;
  prompt: string;
  negativePrompt?: string;
  seed?: number;
  width: number;
  height: number;
  referenceAssetIds?: string[];
  params?: Record<string, unknown>;
}

export interface CopyRecord {
  model: string;
  brief: string;
  sourceUrls: string[];
}

/** Everything needed to reproduce a render exactly. */
export interface Recipe {
  engineVersion: string;
  designSystemVersionId: string;
  templateVersionId: string;
  format: FormatId;
  theme: string;
  slots: SlotValues;
  /** assetId -> how the image was produced (absent for uploads). */
  images: Record<string, ImageGenerationRecord>;
  copy?: CopyRecord;
}

/** JSON with sorted keys, so equal objects hash equally. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v as object)
        .sort()
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

