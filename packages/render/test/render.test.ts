import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { FORMATS, type TemplateSpec } from "@sme/core";
import { sha256 } from "@sme/core/hash";
import { compileTokensCss, componentToTemplate, dataUri, deriveBrandRules, importFromFiles, readDirectory, type DesignSystemBundle } from "@sme/design";
import { Renderer, visualDiff } from "../src";

const OUT = resolve(__dirname, "../../../test-output");
let renderer: Renderer;
let bundle: DesignSystemBundle;
let tokensCss: string;
const assetUrl = (p: string) => {
  const a = bundle.assets.find((x) => x.path === p);
  return a ? dataUri(a.contentType, a.bytes) : null;
};

beforeAll(async () => {
  mkdirSync(OUT, { recursive: true });
  bundle = importFromFiles(await readDirectory(resolve(__dirname, "../../../fixtures/ismii")));
  tokensCss = compileTokensCss(bundle.tokens, {
    fontSrc: (f) => {
      const font = bundle.fonts.find((x) => x.path === f);
      return font ? dataUri(font.contentType, font.bytes) : null;
    },
  }).css;
  renderer = await Renderer.launch();
});
afterAll(async () => renderer?.close());

const lecture = (): TemplateSpec => componentToTemplate(bundle.components.find((c) => c.name === "LecturePost")!)!;

describe("renderer", () => {
  it("renders the LecturePost showcase as a byte-identical PNG every time", async () => {
    const t = lecture();
    const input = { tokensCss, theme: "ivory", format: FORMATS.square, template: t, slots: t.sample as never, assetUrl, imageUrl: () => null, rules: deriveBrandRules(bundle.tokens) };
    const a = await renderer.render(input);
    const b = await renderer.render(input);
    writeFileSync(`${OUT}/lecture-post.png`, a.png);
    expect(sha256(a.png)).toBe(sha256(b.png));
    expect(a.report.issues).toEqual([]);
    expect(a.report.passed).toBe(true);
  });

  it("flags text that does not fit, and too many lines", async () => {
    const t = lecture();
    t.slots.find((s) => s.name === "title")!.maxLines = 2;
    t.slots.find((s) => s.name === "title")!.maxChars = 400;
    const r = await renderer.render({
      tokensCss, theme: "ivory", format: FORMATS.square, template: t, assetUrl, imageUrl: () => null,
      slots: { ...(t.sample as object), title: "A very long lecture title that keeps going and going well past the point where it fits on the post" } as never,
    });
    writeFileSync(`${OUT}/lecture-post-overflow.png`, r.png);
    const codes = r.report.issues.map((i) => i.code);
    expect(codes).toContain("too_many_lines");
    expect(r.report.passed).toBe(false);
  });

  it("measures real contrast and enforces design-system colour rules", async () => {
    const t: TemplateSpec = {
      name: "t", description: "", formats: ["square"], theme: "", role: "single", sample: {},
      html: '<div class="a" data-slot="a">{{a}}</div><div class="b" data-slot="b">{{b}}</div><div class="c" data-slot="c">{{c}}</div>',
      css: ".a { color: var(--rosette-gold); font: 600 40px var(--font-sans); background: var(--marble-ivory); padding: 20px } .b { color: var(--sandstone-red); background: var(--india-ink); font-family: var(--font-sans); font-size: 30px; padding: 20px } .c { color: var(--deep-gold); font-family: var(--font-sans); font-size: 16px; padding: 20px }",
      slots: ["a", "b", "c"].map((n) => ({ name: n, label: n.toUpperCase(), type: "text" as const, description: "", required: true })),
    };
    const r = await renderer.render({ tokensCss, theme: "ivory", format: FORMATS.square, template: t, slots: { a: "Gold text", b: "Red on ink", c: "Small gold" }, assetUrl, imageUrl: () => null, rules: deriveBrandRules(bundle.tokens) });
    const msgs = r.report.issues.map((i) => `${i.slot}: ${i.message}`).join("\n");
    expect(msgs).toMatch(/A is set in rosette-gold/);
    expect(msgs).toMatch(/B has a contrast of 2\.\d:1/);
    expect(msgs).toMatch(/sandstone-red text on india-ink is not allowed/);
    expect(msgs).toMatch(/C uses deep-gold at 16px/);
  });

  it("flags content in the story safe zone and missing fonts", async () => {
    const t: TemplateSpec = {
      name: "t", description: "", formats: ["story"], theme: "", role: "single", sample: {},
      html: '<div class="low" data-slot="a">{{a}}</div><div class="nf" data-slot="b">{{b}}</div>',
      css: ".low { position: absolute; bottom: 40px; left: 80px; font-family: var(--font-sans); font-size: 40px; color: var(--india-ink) } .nf { font-family: var(--font-missing); font-size: 40px }",
      slots: ["a", "b"].map((n) => ({ name: n, label: n.toUpperCase(), type: "text" as const, description: "", required: true })),
    };
    const r = await renderer.render({ tokensCss: tokensCss + ":root{--font-missing: 'Nope Sans', serif}", theme: "", format: FORMATS.story, template: t, slots: { a: "Low", b: "No font" }, assetUrl, imageUrl: () => null });
    const codes = r.report.issues.map((i) => `${i.slot}:${i.code}`);
    expect(codes).toContain("a:safe_zone");
    expect(codes).toContain("b:font_fallback");
  });

  it("blocks network access from templates", async () => {
    const t: TemplateSpec = {
      name: "t", description: "", formats: ["square"], theme: "", role: "single", sample: {},
      html: '<img data-role="logo" src="https://example.com/logo.png">', css: "", slots: [],
    };
    const r = await renderer.render({ tokensCss, theme: "", format: FORMATS.square, template: t, slots: {}, assetUrl, imageUrl: () => null });
    expect(r.report.issues.map((i) => i.code)).toContain("logo_missing");
  });

  it("diffs renders and builds carousel PDFs", async () => {
    const t = lecture();
    const base = { tokensCss, theme: "ivory", format: FORMATS.square, template: t, assetUrl, imageUrl: () => null, skipChecks: true };
    const a = await renderer.render({ ...base, slots: t.sample as never });
    const b = await renderer.render({ ...base, slots: { ...(t.sample as object), title: "Another title" } as never });
    expect(visualDiff(a.png, a.png).diffPixels).toBe(0);
    expect(visualDiff(a.png, b.png).diffPixels).toBeGreaterThan(100);
    const pdf = await renderer.pdf([a.png, b.png], FORMATS.square);
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
