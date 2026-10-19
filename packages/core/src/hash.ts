import { createHash } from "node:crypto";
import { canonicalJson, type Recipe } from "./recipe";

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Only the inputs that change pixels go into the render hash. */
export function recipeHash(r: Recipe): string {
  const { engineVersion, designSystemVersionId, templateVersionId, format, theme, slots } = r;
  return sha256(canonicalJson({ engineVersion, designSystemVersionId, templateVersionId, format, theme, slots }));
}
