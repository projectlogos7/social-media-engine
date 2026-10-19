import { z } from "zod";
import { FORMAT_IDS } from "./formats";

export const SlotSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, "lowercase letters, digits and _"),
  label: z.string().min(1),
  type: z.enum(["text", "image", "list", "choice"]),
  /** Guidance for the AI copywriter / art director. */
  description: z.string().default(""),
  required: z.boolean().default(true),
  minChars: z.number().int().min(0).optional(),
  maxChars: z.number().int().positive().optional(),
  maxLines: z.number().int().positive().optional(),
  /** list slots */
  maxItems: z.number().int().positive().optional(),
  /** choice slots */
  options: z.array(z.string()).optional(),
  /** image slots: where the picture comes from */
  imageSource: z.enum(["generate", "library", "either"]).optional(),
  /** Fixed value: the AI never changes it (e.g. an affiliation line). */
  fixed: z.boolean().optional(),
});
export type Slot = z.infer<typeof SlotSchema>;

export const TemplateSpecSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(""),
  /** Handlebars HTML. Slot elements carry data-slot="<name>"; logos data-role="logo". */
  html: z.string().min(1),
  css: z.string().default(""),
  formats: z.array(z.enum(FORMAT_IDS)).min(1),
  /** Design-system theme id (e.g. "ivory"); empty = first theme. */
  theme: z.string().default(""),
  slots: z.array(SlotSchema),
  /** Sample values used for previews and golden snapshots. */
  sample: z.record(z.string(), z.unknown()).default({}),
  /** "single" posts or a carousel "cover" / "content" / "end" page. */
  role: z.enum(["single", "cover", "content", "end"]).default("single"),
});
export type TemplateSpec = z.infer<typeof TemplateSpecSchema>;

export type SlotValue = string | string[] | ImageRef | null;
export type SlotValues = Record<string, SlotValue>;

/** Reference to an image held in storage (library asset or generation). */
export interface ImageRef {
  kind: "image";
  assetId: string;
  /** Focal point 0..1 for cover crops. */
  focusX?: number;
  focusY?: number;
}

export function isImageRef(v: unknown): v is ImageRef {
  return typeof v === "object" && v !== null && (v as ImageRef).kind === "image" && typeof (v as ImageRef).assetId === "string";
}
