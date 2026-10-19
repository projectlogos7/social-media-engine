import { unzipSync } from "fflate";
import type { TokensFile } from "@sme/core";
import type { BundleAsset, BundleComponent, BundleFile, BundleSection, DesignSystemBundle } from "./bundle";
import { mimeFor } from "./mime";
import { compileTokensCss } from "./tokens-css";

/**
 * Imports a Claude Design System from its files. Accepts
 *  - the exported folder / zip (either the `project/` directory itself or a
 *    tree containing it),
 *  - the one-file page (index.html with the `appifact-doc` file table).
 * Anything that cannot be read becomes a warning, never a crash.
 */

const MAX_FILES = 1200;
const REFUSED_SEGMENT = /(^|\/)(\.[^/]*|node_modules)(\/|$)/;
const TABLE_PATHS = new Set(["index.html", "design-system.json", "SKILL.md", "manifest.json"]);
const textDecoder = new TextDecoder();

export type FileMap = Map<string, Uint8Array>;

export class ImportError extends Error {}

export function importFromZip(zip: Uint8Array): DesignSystemBundle {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zip);
  } catch {
    throw new ImportError("That file is not a readable zip archive.");
  }
  const files: FileMap = new Map();
  for (const [p, bytes] of Object.entries(entries)) {
    if (p.endsWith("/")) continue;
    files.set(p.replace(/\\/g, "/"), bytes);
  }
  return importFromFiles(files);
}

/** The one-file page: `<script type="application/json" id="appifact-doc">{title, content:{v, files}}</script>`. */
export function importFromSingleHtml(html: string): DesignSystemBundle {
  const m = /<script type="application\/json" id="appifact-doc">\n?([\s\S]*?)\n?<\/script>/.exec(html);
  if (!m) throw new ImportError("This HTML file does not contain a design system (no appifact-doc block). Export the design system folder instead.");
  let doc: { title?: string; content?: { files?: Record<string, string> } };
  try {
    doc = JSON.parse(m[1]);
  } catch {
    throw new ImportError("The design system block in this HTML file is not valid JSON.");
  }
  const table = doc.content?.files ?? {};
  const files: FileMap = new Map();
  const warnings: string[] = [];
  for (const [p, v] of Object.entries(table)) {
    if (/^(blob|file):/.test(v)) {
      warnings.push(`"${p}" is stored outside the page (${v.split(":")[0]}) and could not be read; export the folder to include it.`);
      continue;
    }
    const comma = v.indexOf(",");
    if (v.startsWith("data:") && comma > 0) {
      const head = v.slice(0, comma);
      const payload = v.slice(comma + 1);
      files.set(p, head.includes(";base64") ? new Uint8Array(Buffer.from(payload, "base64")) : new TextEncoder().encode(decodeURIComponent(payload)));
    } else {
      files.set(p, new TextEncoder().encode(v));
    }
  }
  const bundle = importFromFiles(files);
  if (doc.title && bundle.name === "Untitled design system") bundle.name = doc.title;
  bundle.warnings.unshift(...warnings);
  return bundle;
}

/** Finds the design-system root: the directory holding tokens.json (preferring `project/`). */
function findRoot(paths: string[]): string {
  const candidates = paths.filter((p) => p === "tokens.json" || p.endsWith("/tokens.json")).map((p) => p.slice(0, -"tokens.json".length));
  if (!candidates.length) throw new ImportError("No tokens.json found. Upload the Claude Design System export (the folder that contains tokens.json).");
  candidates.sort((a, b) => {
    const pa = a.endsWith("project/") ? 0 : 1;
    const pb = b.endsWith("project/") ? 0 : 1;
    return pa - pb || a.length - b.length;
  });
  return candidates[0];
}

function titleOf(markdown: string, path: string): string {
  const h = /^#\s+(.+)$/m.exec(markdown);
  if (h) return h[1].trim();
  return path.split("/").pop()!.replace(/\.(md|mdx)$/i, "").replace(/^\d+[-_ ]*/, "").replace(/[-_]/g, " ");
}

function normalizeComponentPath(rel: string): { comp: string; kind: "preview" | "readme"; group?: string } | null {
  let m = /^components\/([^/]+)\/(preview\.html|index\.html)$/.exec(rel);
  if (m) return { comp: m[1], kind: "preview" };
  m = /^components\/([^/]+)\.html$/.exec(rel);
  if (m) return { comp: m[1], kind: "preview" };
  m = /^components\/([^/]+)\/(README\.md|usage\.md)$/i.exec(rel);
  if (m) return { comp: m[1], kind: "readme" };
  m = /^components\/([^/]+)\.prompt\.md$/.exec(rel);
  if (m) return { comp: m[1], kind: "readme" };
  m = /^components\/([^/]+)\/([^/]+)\/\2\.(html|prompt\.md)$/.exec(rel);
  if (m) return { comp: m[2], kind: m[3] === "html" ? "preview" : "readme", group: m[1] };
  return null;
}

export function importFromFiles(input: FileMap): DesignSystemBundle {
  const warnings: string[] = [];
  const all = [...input.keys()].filter((p) => !REFUSED_SEGMENT.test(p));
  if (all.length > MAX_FILES) throw new ImportError(`Too many files (${all.length}); a design system holds at most ${MAX_FILES}.`);
  const root = findRoot(all);
  const files: FileMap = new Map();
  for (const p of all) if (p.startsWith(root)) files.set(p.slice(root.length), input.get(p)!);
  const text = (p: string) => (files.has(p) ? textDecoder.decode(files.get(p)!) : undefined);

  let tokens: TokensFile;
  try {
    tokens = JSON.parse(text("tokens.json")!);
  } catch {
    throw new ImportError("tokens.json is not valid JSON.");
  }
  if (!tokens || typeof tokens !== "object") throw new ImportError("tokens.json must be an object.");
  if (tokens.color && !Array.isArray(tokens.color.tokens)) {
    warnings.push("Colours in tokens.json are a name-to-value map; Claude design systems use a list of {name, value, usage}. They were ignored.");
    tokens.color = { themes: tokens.color.themes, tokens: [] };
  }

  // Manifest / design-system.json map blob ids to asset paths, so previews can be rewritten.
  const blobToPath = new Map<string, string>();
  const dsJson = text("design-system.json");
  let namespace = "";
  let title = "";
  if (dsJson) {
    try {
      const ds = JSON.parse(dsJson) as {
        namespace?: string;
        title?: string;
        assetGroups?: Record<string, { files?: Record<string, { blob?: string; name?: string }> }>;
      };
      namespace = ds.namespace ?? "";
      title = ds.title ?? "";
      for (const [g, grp] of Object.entries(ds.assetGroups ?? {})) {
        for (const [name, f] of Object.entries(grp.files ?? {})) if (f.blob) blobToPath.set(f.blob, `assets/${g}/${f.name ?? name}`);
      }
    } catch {
      warnings.push("design-system.json could not be parsed; asset links in previews may not resolve.");
    }
  }
  const manifest = text("manifest.json");
  if (manifest) {
    try {
      const mf = JSON.parse(manifest) as {
        namespace?: string;
        name?: string;
        storage?: { files?: Record<string, { id?: string }> };
        assetGroups?: { name: string; files?: { path: string; id: string }[] }[];
      };
      namespace ||= mf.namespace ?? "";
      title ||= mf.name ?? "";
      for (const [p, rec] of Object.entries(mf.storage?.files ?? {})) if (rec.id) blobToPath.set(rec.id, p);
      for (const g of mf.assetGroups ?? []) for (const f of g.files ?? []) blobToPath.set(f.id, f.path);
    } catch {
      warnings.push("manifest.json could not be parsed.");
    }
  }

  // Readme + sections
  const readmePath = files.has("README.md") ? "README.md" : files.has("readme.md") ? "readme.md" : undefined;
  const readme = (readmePath ? text(readmePath)! : "").split(/\n---\n## Consuming this system/)[0].trim();
  if (!readme) warnings.push("No README.md (brand book) found.");
  const sections: BundleSection[] = [];
  for (const p of [...files.keys()].sort()) {
    if (p === readmePath || !/\.(md|mdx)$/i.test(p)) continue;
    if (p.startsWith("components/") || p.startsWith("assets/") || p.startsWith("api/") || p.startsWith("artifact-type/") || TABLE_PATHS.has(p)) continue;
    const md = text(p)!;
    sections.push({ path: p, title: titleOf(md, p), markdown: md });
  }
  const voiceSection = sections.find((s) => /voice|tone|writing/i.test(s.title) || /voice/i.test(s.path));

  // Fonts
  const fonts: BundleFile[] = [];
  for (const p of files.keys()) {
    if (!p.startsWith("fonts/")) continue;
    const bytes = files.get(p)!;
    const sig = textDecoder.decode(bytes.slice(0, 4));
    const okSig = sig === "wOF2" || sig === "wOFF" || sig === "OTTO" || (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0) || sig === "true";
    if (!okSig) {
      warnings.push(`"${p}" is not a font file and was skipped.`);
      continue;
    }
    fonts.push({ path: p, contentType: mimeFor(p), bytes });
  }
  for (const f of tokens.type?.fonts ?? []) {
    const file = f.file.includes("/") ? f.file : `fonts/${f.file}`;
    if (!files.has(file)) warnings.push(`Font "${f.family}" points to ${file}, which is not in the export.`);
  }

  // Assets
  const assets: BundleAsset[] = [];
  const groupNotes: Record<string, string> = {};
  for (const p of [...files.keys()].sort()) {
    if (!p.startsWith("assets/")) continue;
    const rest = p.slice("assets/".length);
    const parts = rest.split("/");
    const group = parts.length > 1 ? parts[0] : "Other";
    const name = parts.slice(parts.length > 1 ? 1 : 0).join("/");
    if (/^readme\.md$/i.test(name)) {
      groupNotes[group] = text(p)!;
      continue;
    }
    if (name.endsWith(".json")) continue;
    assets.push({ path: p, group, name, contentType: mimeFor(p), bytes: files.get(p)! });
  }
  const assetPaths = new Set(assets.map((a) => a.path));
  for (const [id, p] of blobToPath) if (!assetPaths.has(p)) warnings.push(`Asset ${p} (${id}) is listed but its file is not in the export.`);

  // Components
  const comps = new Map<string, BundleComponent>();
  for (const p of [...files.keys()].sort()) {
    const n = normalizeComponentPath(p);
    if (!n) continue;
    const c = comps.get(n.comp) ?? { name: n.comp, group: n.group };
    if (n.kind === "readme") c.readme = text(p);
    else {
      let html = text(p)!;
      const marker = /<!--\s*@dsCard([^>]*)-->/.exec(html);
      const g = marker && /group="([^"]*)"/.exec(marker[1]);
      if (g) c.group = g[1];
      html = html.replace(/\/_blob\/([0-9a-f]{32})/g, (whole, id: string) => {
        const target = blobToPath.get(id);
        if (target) return `asset:${target}`;
        warnings.push(`Component ${n.comp} references an unknown asset ${id}.`);
        return whole;
      });
      c.previewHtml = html;
    }
    comps.set(n.comp, c);
  }

  const compiled = compileTokensCss(tokens, { fontSrc: (f) => f });
  warnings.push(...compiled.warnings);

  return {
    name: (tokens.name as string | undefined) || title || namespace || "Untitled design system",
    namespace: namespace || ((tokens.name as string | undefined) ?? "").replace(/[^A-Za-z0-9]/g, "") || "DS",
    tokens,
    readme,
    sections,
    voice: voiceSection?.markdown ?? "",
    fonts,
    assets,
    groupNotes,
    components: [...comps.values()],
    warnings,
  };
}

/** Reads a directory tree from disk into a FileMap (used by the seed script and tests). */
export async function readDirectory(dir: string): Promise<FileMap> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { join, relative } = await import("node:path");
  const out: FileMap = new Map();
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) await walk(full);
      else out.set(relative(dir, full).split("\\").join("/"), new Uint8Array(await readFile(full)));
    }
  };
  await walk(dir);
  return out;
}
