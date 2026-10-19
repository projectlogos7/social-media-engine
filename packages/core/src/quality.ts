export type Severity = "error" | "warning";

export interface QualityIssue {
  code:
    | "text_overflow"
    | "too_many_lines"
    | "too_long"
    | "too_short"
    | "missing_required"
    | "low_contrast"
    | "contrast_unknown"
    | "logo_missing"
    | "safe_zone"
    | "out_of_canvas"
    | "font_fallback"
    | "image_missing"
    | "palette_drift"
    | "banned_word"
    | "unsourced_claim"
    | "lint";
  severity: Severity;
  message: string;
  slot?: string;
}

export interface QualityReport {
  passed: boolean;
  issues: QualityIssue[];
}

export function report(issues: QualityIssue[]): QualityReport {
  return { passed: !issues.some((i) => i.severity === "error"), issues };
}
