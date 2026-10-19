import { chromium, type Browser, type Page } from "playwright";
import sharp from "sharp";
import { type Format, type QualityIssue, type QualityReport, type Slot, type TemplateSpec, contrastRatio, deltaE, parseColor, report, requiredContrast, blend } from "@sme/core";
import type { BrandRules } from "@sme/design";
import { buildDocument, type DocumentInput } from "./document";
import { validateSlotValues } from "./checks";

export interface RenderInput extends DocumentInput {
  template: Pick<TemplateSpec, "html" | "css" | "slots">;
  rules?: BrandRules;
  bannedWords?: string[];
  /** Skip quality checks (faster; used for thumbnails). */
  skipChecks?: boolean;
}

export interface RenderResult {
  png: Buffer;
  html: string;
  report: QualityReport;
}

interface Measured {
  slots: {
    name: string;
    rect: { x: number; y: number; w: number; h: number };
    overflowX: boolean;
    overflowY: boolean;
    lines: number;
    color: string;
    fontSize: number;
    fontWeight: number;
    family: string;
    hasText: boolean;
    visible: boolean;
  }[];
  logos: { rect: { x: number; y: number; w: number; h: number }; loaded: boolean; visible: boolean }[];
  brokenImages: string[];
  loadedFamilies: string[];
  failedFamilies: string[];
}

/** Runs in the page: measures every slot element and logo. */
function measure(): Measured {
  const canvas = document.querySelector(".canvas") as HTMLElement;
  const c = canvas.getBoundingClientRect();
  const rel = (r: DOMRect) => ({ x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height });
  const slots: Measured["slots"] = [];
  for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-slot]"))) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(el);
    const tops: number[] = [];
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    for (const rr of Array.from(range.getClientRects())) {
      if (rr.width < 1 || rr.height < 1) continue;
      if (!tops.some((t) => Math.abs(t - rr.top) < lh / 2)) tops.push(rr.top);
    }
    // An element clipped by an ancestor with overflow hidden is overflowing too.
    let clipped = false;
    for (let p = el.parentElement; p && p !== canvas.parentElement; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflow !== "visible" || pcs.overflowY !== "visible") {
        const pr = p.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.right > pr.right + 1 || r.top < pr.top - 1 || r.left < pr.left - 1) clipped = true;
        break;
      }
    }
    slots.push({
      name: el.dataset.slot!,
      rect: rel(r),
      // Fonts with tall ascenders report a few px of scroll overflow even when every
      // line fits, so overflow is measured in whole lines and real (word-length) widths.
      overflowX: (cs.overflowX !== "visible" && el.scrollWidth - el.clientWidth > Math.max(4, parseFloat(cs.fontSize) * 0.2)) || (clipped && r.right > c.right),
      overflowY: (cs.overflowY !== "visible" && tops.length * lh > el.clientHeight + 2) || clipped,
      lines: tops.length,
      color: cs.color,
      fontSize: parseFloat(cs.fontSize),
      fontWeight: parseInt(cs.fontWeight, 10) || 400,
      family: cs.fontFamily,
      hasText: (el.textContent ?? "").trim().length > 0,
      visible: cs.visibility !== "hidden" && cs.display !== "none" && r.width > 0 && r.height > 0,
    });
  }
  const logos = Array.from(document.querySelectorAll<HTMLElement>('[data-role="logo"]')).map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const img = el instanceof HTMLImageElement ? el : el.querySelector("img");
    return {
      rect: rel(r),
      loaded: img ? img.complete && img.naturalWidth > 0 : true,
      visible: cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05 && r.width > 0,
    };
  });
  const brokenImages = Array.from(document.images)
    .filter((i) => !i.complete || i.naturalWidth === 0)
    .map((i) => (i.getAttribute("src") ?? "").slice(0, 60));
  const loaded = new Set<string>();
  const failed = new Set<string>();
  document.fonts.forEach((f) => {
    const fam = f.family.replace(/^["']|["']$/g, "");
    if (f.status === "loaded") loaded.add(fam);
    if (f.status === "error") failed.add(fam);
  });
  return { slots, logos, brokenImages, loadedFamilies: [...loaded], failedFamilies: [...failed] };
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-monospace", "ui-serif", "ui-sans-serif"]);

function firstFamily(stack: string): string {
  return stack.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

class Semaphore {
  private queue: (() => void)[] = [];
  constructor(private free: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.queue.push(r));
    try {
      return await fn();
    } finally {
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    }
  }
}

export class Renderer {
  private constructor(private browser: Browser, private sem: Semaphore) {}

  static async launch(opts: { concurrency?: number } = {}): Promise<Renderer> {
    const browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
      args: ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb", "--disable-gpu", "--hide-scrollbars", "--disable-skia-runtime-opts"],
    });
    return new Renderer(browser, new Semaphore(opts.concurrency ?? 3));
  }

  get chromiumVersion(): string {
    return this.browser.version();
  }

  async close() {
    await this.browser.close();
  }

  private async withPage<T>(format: Format, fn: (page: Page) => Promise<T>): Promise<T> {
    return this.sem.run(async () => {
      const ctx = await this.browser.newContext({ viewport: { width: format.width, height: format.height }, deviceScaleFactor: 1, javaScriptEnabled: true, colorScheme: "light", locale: "en-US", timezoneId: "UTC" });
      // Templates are self-contained: every network request is refused.
      await ctx.route("**/*", (route) => route.abort());
      try {
        const page = await ctx.newPage();
        return await fn(page);
      } finally {
        await ctx.close();
      }
    });
  }

  async render(input: RenderInput): Promise<RenderResult> {
    const { html, missing } = buildDocument(input);
    const pre: QualityIssue[] = input.skipChecks ? [] : validateSlotValues(input.template, input.slots, input.bannedWords);
    for (const m of missing) pre.push({ code: m.startsWith("image:") ? "image_missing" : "lint", severity: "error", message: `Missing ${m.startsWith("image:") ? "image" : "asset"} ${m.split(":").slice(1).join(":")}.` });
    return this.withPage(input.format, async (page) => {
      await page.setContent(html, { waitUntil: "load" });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(Array.from(document.images).map((i) => (i.complete ? null : i.decode().catch(() => null))));
      });
      const clip = { x: 0, y: 0, width: input.format.width, height: input.format.height };
      const png = await page.screenshot({ clip, type: "png", animations: "disabled", caret: "hide", scale: "css" });
      if (input.skipChecks) return { png, html, report: report(pre) };
      const m = await page.evaluate(measure);
      // Second pass: hide slot text to see exactly what sits behind it.
      await page.addStyleTag({ content: "[data-slot], [data-slot] * { color: transparent !important; text-shadow: none !important; -webkit-text-stroke: 0 !important; text-decoration-color: transparent !important; }" });
      const bgPng = await page.screenshot({ clip, type: "png", animations: "disabled", caret: "hide", scale: "css" });
      const issues = [...pre, ...(await this.analyse(input, m, bgPng))];
      return { png, html, report: report(issues) };
    });
  }

  private async analyse(input: RenderInput, m: Measured, bgPng: Buffer): Promise<QualityIssue[]> {
    const issues: QualityIssue[] = [];
    const { format } = input;
    const slotDefs = new Map<string, Slot>(input.template.slots.map((s) => [s.name, s]));
    const { data, info } = await sharp(bgPng).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number): [number, number, number] => {
      const i = (Math.min(info.height - 1, Math.max(0, y)) * info.width + Math.min(info.width - 1, Math.max(0, x))) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    };
    const loaded = new Set(m.loadedFamilies);
    for (const f of m.failedFamilies) issues.push({ code: "font_fallback", severity: "error", message: `The font "${f}" failed to load.` });

    for (const s of m.slots) {
      const def = slotDefs.get(s.name);
      const label = def?.label ?? s.name;
      if (!s.visible || !s.hasText) continue;
      const r = s.rect;
      if (s.overflowX || s.overflowY) issues.push({ code: "text_overflow", severity: "error", slot: s.name, message: `${label} does not fit its box. Shorten the text.` });
      if (r.x < -1 || r.y < -1 || r.x + r.w > format.width + 1 || r.y + r.h > format.height + 1)
        issues.push({ code: "out_of_canvas", severity: "error", slot: s.name, message: `${label} runs off the edge of the image.` });
      if (def?.maxLines && s.lines > def.maxLines)
        issues.push({ code: "too_many_lines", severity: "error", slot: s.name, message: `${label} wraps to ${s.lines} lines; the most is ${def.maxLines}.` });
      if (format.safeBottom && r.y + r.h > format.height - format.safeBottom)
        issues.push({ code: "safe_zone", severity: "error", slot: s.name, message: `${label} sits in the bottom ${format.safeBottom}px, where ${format.label.split(" ·")[0]} UI covers it.` });
      if (format.safeTop && r.y < format.safeTop)
        issues.push({ code: "safe_zone", severity: "error", slot: s.name, message: `${label} sits in the top ${format.safeTop}px, where platform UI covers it.` });
      const fam = firstFamily(s.family);
      if (!GENERIC.has(fam) && !loaded.has(fam)) issues.push({ code: "font_fallback", severity: "error", slot: s.name, message: `${label} is set in "${fam}", which is not loaded; it would render in a fallback font.` });

      // Contrast against the real pixels behind the text.
      const fg = parseColor(s.color);
      if (!fg || fg[3] === 0) continue;
      const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
      const x1 = Math.min(format.width - 1, Math.ceil(r.x + r.w)), y1 = Math.min(format.height - 1, Math.ceil(r.y + r.h));
      const step = Math.max(1, Math.round(Math.sqrt(((x1 - x0) * (y1 - y0)) / 4000)));
      const ratios: number[] = [];
      const bgSamples: [number, number, number][] = [];
      for (let y = y0; y <= y1; y += step)
        for (let x = x0; x <= x1; x += step) {
          const bg = pixel(x, y);
          bgSamples.push(bg);
          const text = blend(fg, [...bg, 1]);
          ratios.push(contrastRatio(text, [...bg, 1]));
        }
      if (!ratios.length) continue;
      ratios.sort((a, b) => a - b);
      const median = ratios[Math.floor(ratios.length / 2)];
      const p10 = ratios[Math.floor(ratios.length * 0.1)];
      const need = requiredContrast(s.fontSize, s.fontWeight);
      if (median < need)
        issues.push({ code: "low_contrast", severity: "error", slot: s.name, message: `${label} has a contrast of ${median.toFixed(1)}:1 against its background; it needs ${need}:1.` });
      else if (p10 < need)
        issues.push({ code: "low_contrast", severity: "warning", slot: s.name, message: `Parts of ${label} cross a busy or light area (${p10.toFixed(1)}:1 at worst; needs ${need}:1).` });

      // Brand colour rules from the design system.
      const fgRgb: [number, number, number] = [fg[0], fg[1], fg[2]];
      const near = (hex: string) => {
        const c = parseColor(hex);
        return !!c && deltaE(fgRgb, [c[0], c[1], c[2]]) < 2;
      };
      const rules = input.rules;
      if (rules) {
        for (const rule of rules.neverText) if (near(rule.hex)) issues.push({ code: "low_contrast", severity: "error", slot: s.name, message: `${label} is set in ${rule.token}, which the design system never uses for text.` });
        for (const rule of rules.minTextPx)
          if (near(rule.hex) && s.fontSize < rule.px)
            issues.push({ code: "low_contrast", severity: "error", slot: s.name, message: `${label} uses ${rule.token} at ${Math.round(s.fontSize)}px; the design system allows it only at ${rule.px}px and up.` });
        const medBg = bgSamples[Math.floor(bgSamples.length / 2)];
        for (const rule of rules.forbiddenPairs) {
          const b = parseColor(rule.bgHex);
          if (near(rule.fgHex) && b && deltaE(medBg, [b[0], b[1], b[2]]) < 6)
            issues.push({ code: "low_contrast", severity: "error", slot: s.name, message: `${label}: ${rule.fg} text on ${rule.bg} is not allowed by the design system.` });
        }
      }
    }

    // Text slots must not collide with each other.
    const vis = m.slots.filter((s) => s.visible && s.hasText);
    for (let i = 0; i < vis.length; i++)
      for (let j = i + 1; j < vis.length; j++) {
        const a = vis[i].rect, b = vis[j].rect;
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (w > 2 && h > 2) {
          const la = slotDefs.get(vis[i].name)?.label ?? vis[i].name, lb = slotDefs.get(vis[j].name)?.label ?? vis[j].name;
          issues.push({ code: "text_overflow", severity: "error", slot: vis[i].name, message: `${la} overlaps ${lb}.` });
        }
      }

    for (const l of m.logos) {
      if (!l.loaded || !l.visible) issues.push({ code: "logo_missing", severity: "error", message: "The logo did not render." });
      const r = l.rect;
      if (r.x < 0 || r.y < 0 || r.x + r.w > format.width || r.y + r.h > format.height) issues.push({ code: "out_of_canvas", severity: "error", message: "The logo runs off the edge of the image." });
      if (format.safeBottom && r.y + r.h > format.height - format.safeBottom) issues.push({ code: "safe_zone", severity: "error", message: `The logo sits in the bottom ${format.safeBottom}px platform UI zone.` });
    }
    for (const b of m.brokenImages) issues.push({ code: "image_missing", severity: "error", message: `An image failed to load (${b}…).` });
    return issues;
  }

  /** Renders PNG pages into one PDF (LinkedIn document carousels). */
  async pdf(pages: Buffer[], format: Format): Promise<Buffer> {
    const body = pages
      .map((p) => `<div class="p"><img src="data:image/png;base64,${p.toString("base64")}"></div>`)
      .join("");
    const html = `<!doctype html><html><head><style>@page { size: ${format.width}px ${format.height}px; margin: 0 } html,body{margin:0} .p{width:${format.width}px;height:${format.height}px;page-break-after:always;overflow:hidden} .p:last-child{page-break-after:auto} img{display:block;width:100%;height:100%}</style></head><body>${body}</body></html>`;
    return this.withPage(format, async (page) => {
      await page.setContent(html, { waitUntil: "load" });
      return page.pdf({ width: `${format.width}px`, height: `${format.height}px`, printBackground: true, margin: { top: "0", right: "0", bottom: "0", left: "0" } });
    });
  }

  /** Loads a live web page with JavaScript (crawling sites that render client-side). Network allowed. */
  async fetchRenderedHtml(url: string): Promise<string> {
    return this.sem.run(async () => {
      const ctx = await this.browser.newContext({ userAgent: "SocialMediaEngineBot/1.0 (+content import for the site owner)", javaScriptEnabled: true });
      try {
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
        return await page.content();
      } finally {
        await ctx.close();
      }
    });
  }

  /** Renders arbitrary trusted HTML (used for placeholder images and previews). */
  async screenshotHtml(html: string, width: number, height: number): Promise<Buffer> {
    return this.withPage({ id: "square", label: "", width, height, platforms: [], safeBottom: 0, safeTop: 0 }, async (page) => {
      await page.setContent(html, { waitUntil: "load" });
      return page.screenshot({ clip: { x: 0, y: 0, width, height }, type: "png" });
    });
  }
}
