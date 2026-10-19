import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { compileTokensCss, componentToTemplate, deriveBrandRules, importFromFiles, lintTemplate, readDirectory, resolveColor, starterTemplates } from "../src";

const FIXTURE = resolve(__dirname, "../../../fixtures/ismii");

describe("Claude design system import (ISMII)", async () => {
  const files = await readDirectory(FIXTURE);
  const bundle = importFromFiles(files);

  it("reads name, sections, voice, fonts and assets", () => {
    expect(bundle.name).toBe("ISMII");
    expect(bundle.sections.map((s) => s.title)).toContain("Voice");
    expect(bundle.voice).toMatch(/Speak as "we."/);
    expect(bundle.fonts).toHaveLength(6);
    expect(bundle.assets.length).toBe(25);
    expect(bundle.groupNotes.Lockups).toMatch(/official signature/);
    expect(bundle.warnings).toEqual([]);
  });

  it("rewrites /_blob/ links in previews to asset paths", () => {
    const lp = bundle.components.find((c) => c.name === "LecturePost")!;
    expect(lp.previewHtml).toContain("asset:assets/Social-templates/ismii-post-frame-square-1080x1080-sandstone.png");
    expect(lp.previewHtml).not.toContain("/_blob/");
  });

  it("works when the export is nested under project/", () => {
    const nested = new Map([...files].map(([p, b]) => [`ISMII export/project/${p}`, b]));
    expect(importFromFiles(nested).assets.length).toBe(25);
  });

  it("compiles tokens like Claude does", () => {
    const { css, themes } = compileTokensCss(bundle.tokens);
    expect(themes).toEqual(["ivory", "ink"]);
    expect(css).toContain(':root, [data-theme="ivory"]');
    expect(css).toContain("--sandstone-red: #9e3d22;");
    expect(css).toContain("--ground: var(--marble-ivory);");
    expect(css).toMatch(/\[data-theme="ink"\] \{[^}]*--ground: var\(--india-ink\);/);
    expect(css).toContain("--space-6: 48px;");
    expect(css).toContain("--font-serif:");
    expect(css).toMatch(/\.display \{ font-family: var\(--font-serif\); font-size: 48px; line-height: 54px; font-weight: 600/);
    expect(css).toMatch(/\.label \{[^}]*text-transform: uppercase/);
    expect(resolveColor(bundle.tokens, "text", "ink")).toBe("#f4efe6");
    expect(resolveColor(bundle.tokens, "brand")).toBe("#9e3d22");
  });

  it("derives machine-checkable rules from token usage notes", () => {
    const r = deriveBrandRules(bundle.tokens);
    expect(r.neverText.map((x) => x.token)).toContain("rosette-gold");
    expect(r.minTextPx).toContainEqual(expect.objectContaining({ token: "deep-gold", px: 24 }));
    expect(r.forbiddenPairs).toContainEqual(expect.objectContaining({ fg: "sandstone-red", bg: "india-ink" }));
  });

  it("converts the LecturePost showcase into a template with slots", () => {
    const t = componentToTemplate(bundle.components.find((c) => c.name === "LecturePost")!)!;
    expect(t.slots.map((s) => s.name)).toEqual(["eyebrow", "title", "who", "aff", "when"]);
    expect(t.html).toContain("zoom: 2.5");
    expect(t.css).toContain('{{asset "Social-templates/ismii-post-frame-square-1080x1080-sandstone.png"}}');
    const issues = lintTemplate(t, { tokens: bundle.tokens, assetPaths: new Set(bundle.assets.map((a) => a.path)), rules: deriveBrandRules(bundle.tokens) });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("lints raw colours, foreign fonts, scripts and rule breaks", () => {
    const ctx = { tokens: bundle.tokens, assetPaths: new Set<string>(), rules: deriveBrandRules(bundle.tokens) };
    const bad = lintTemplate(
      {
        name: "x", description: "", formats: ["square"], theme: "", role: "single", sample: {},
        html: '<div data-slot="a" style="color: #ff0000">{{a}}</div><script>1</script><img src="https://x.com/a.png">',
        css: ".a { font-family: Arial; color: var(--rosette-gold); background: white }",
        slots: [{ name: "a", label: "A", type: "text", description: "", required: true }],
      },
      ctx,
    ).filter((i) => i.severity === "error").map((i) => i.message).join("\n");
    expect(bad).toMatch(/Raw hex/);
    expect(bad).toMatch(/<script>/);
    expect(bad).toMatch(/remote files/);
    expect(bad).toMatch(/font-family must be/);
    expect(bad).toMatch(/rosette-gold" may never set text/);
    expect(bad).toMatch(/Named colour/);
  });

  it("starter kit templates lint clean", () => {
    const ctx = { tokens: bundle.tokens, assetPaths: new Set(bundle.assets.map((a) => a.path)), rules: deriveBrandRules(bundle.tokens) };
    for (const t of starterTemplates({ ground: "ground", text: "text", accent: "brand", headingFamily: "serif", bodyFamily: "sans", logo: "Lockups/ismii-lockup-horizontal-full-colour.svg" })) {
      expect(lintTemplate(t, ctx).filter((i) => i.severity === "error"), t.name).toEqual([]);
    }
  });
});
