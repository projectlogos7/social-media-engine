import { type QualityIssue, type Slot, type SlotValues, type TemplateSpec, isImageRef } from "@sme/core";

/** Checks that need no rendering: required slots, lengths, choices, banned words. */
export function validateSlotValues(spec: Pick<TemplateSpec, "slots">, values: SlotValues, bannedWords: string[] = []): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const banned = bannedWords.map((w) => w.trim()).filter(Boolean);
  for (const s of spec.slots) {
    const v = values[s.name];
    const empty = v === undefined || v === null || (typeof v === "string" && !v.trim()) || (Array.isArray(v) && !v.length);
    if (empty) {
      if (s.required) issues.push({ code: s.type === "image" ? "image_missing" : "missing_required", severity: "error", slot: s.name, message: `${s.label} is required.` });
      continue;
    }
    if (s.type === "image") {
      if (!isImageRef(v)) issues.push({ code: "image_missing", severity: "error", slot: s.name, message: `${s.label} must be an image.` });
      continue;
    }
    const texts = Array.isArray(v) ? v : [String(v)];
    if (s.type === "list" && s.maxItems && texts.length > s.maxItems)
      issues.push({ code: "too_long", severity: "error", slot: s.name, message: `${s.label} has ${texts.length} items; the most is ${s.maxItems}.` });
    if (s.type === "choice" && s.options && !s.options.includes(texts[0]))
      issues.push({ code: "lint", severity: "error", slot: s.name, message: `${s.label} must be one of: ${s.options.join(", ")}.` });
    for (const t of texts) {
      if (s.maxChars && t.length > s.maxChars)
        issues.push({ code: "too_long", severity: "error", slot: s.name, message: `${s.label} is ${t.length} characters; the limit is ${s.maxChars}.` });
      if (s.minChars && t.length < s.minChars)
        issues.push({ code: "too_short", severity: "warning", slot: s.name, message: `${s.label} is shorter than ${s.minChars} characters.` });
      for (const w of banned) {
        const re = new RegExp(`(^|[^\\p{L}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}])`, "iu");
        if (re.test(t)) issues.push({ code: "banned_word", severity: "error", slot: s.name, message: `${s.label} uses "${w}", which the brand voice does not allow.` });
      }
    }
  }
  return issues;
}

export function slotByName(slots: Slot[], name: string): Slot | undefined {
  return slots.find((s) => s.name === name);
}
