import { parseHTML } from "linkedom";
import type { FormatId, Slot, TemplateSpec } from "@sme/core";
import { FORMATS } from "@sme/core";
import type { BundleComponent } from "./bundle";

/**
 * Turns a design-system showcase component (components/<Comp>/preview.html)
 * into a starting template: the first composition becomes the canvas, every
 * leaf text element with a class becomes a text slot, asset links become
 * {{asset}} helpers, and the composition is scaled to the format width.
 */
export function componentToTemplate(comp: BundleComponent, format: FormatId = "square"): TemplateSpec | null {
  if (!comp.previewHtml) return null;
  const html = comp.previewHtml.replace(/<!--[\s\S]*?-->/g, "");
  const { document } = parseHTML(html);
  const styleText = [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
  const body = document.querySelector("body");
  if (!body) return null;
  const root = [...body.children].find((el) => el.tagName !== "SCRIPT" && el.tagName !== "STYLE");
  if (!root) return null;
  // A showcase often shows the same composition twice (two grounds); keep the first.
  let composition: Element = root;
  const kids = [...root.children];
  if (kids.length > 1 && kids.every((k) => k.className === kids[0].className) && !/post|frame|card/i.test(root.className)) composition = kids[0];

  const slots: Slot[] = [];
  const sample: Record<string, unknown> = {};
  const taken = new Set<string>();
  const walk = (el: Element) => {
    const children = [...el.children];
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (!children.length && text && el.tagName !== "SCRIPT" && el.tagName !== "STYLE") {
      const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean)[0] ?? el.tagName.toLowerCase();
      let name = cls.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^[^a-z]+/, "") || "text";
      let n = 2;
      const base = name;
      while (taken.has(name)) name = `${base}_${n++}`;
      taken.add(name);
      slots.push({
        name,
        label: base.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        type: "text",
        description: `Replaces the sample text "${text}".`,
        required: true,
        maxChars: Math.max(12, Math.round(text.length * 1.6)),
      });
      sample[name] = text;
      el.setAttribute("data-slot", name);
      el.textContent = `{{${name}}}`;
      return;
    }
    children.forEach(walk);
  };
  walk(composition);
  composition.removeAttribute("aria-label");

  // Width of the composition, to scale it up to the canvas.
  const cls = (composition.getAttribute("class") ?? "").split(/\s+/)[0];
  const widthMatch = cls ? new RegExp(`\\.${cls}\\s*\\{[^}]*?width\\s*:\\s*(\\d+)px`).exec(styleText) : null;
  const nativeWidth = widthMatch ? Number(widthMatch[1]) : 0;
  const zoom = nativeWidth ? +(FORMATS[format].width / nativeWidth).toFixed(4) : 1;

  const assetize = (s: string) => s.replace(/asset:(assets\/[^'")\s]+)/g, (_m, p: string) => `{{asset "${p.replace(/^assets\//, "")}"}}`);
  const css = styleText
    .split("}")
    .map((r) => r.trim())
    .filter((r) => r && !/^(html|body)\b/.test(r.split("{")[0].trim()) && r.includes("{"))
    .map((r) => r + "}")
    .join("\n");

  const markup = `<div class="ds-scale" style="zoom: ${zoom}">\n${composition.outerHTML}\n</div>`;
  return {
    name: comp.name.replace(/([a-z])([A-Z])/g, "$1 $2"),
    description: comp.readme?.replace(/^#.*\n+/, "").trim().split("\n")[0] ?? "",
    html: assetize(markup),
    css: assetize(css),
    formats: [format],
    theme: "",
    slots,
    sample,
    role: "single",
  };
}
