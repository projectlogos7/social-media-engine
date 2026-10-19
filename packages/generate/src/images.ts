import sharp from "sharp";
import { createHash } from "node:crypto";

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed: number;
  n: number;
  model?: string;
  /** Reference images (brand style), for providers that accept them. */
  references?: Buffer[];
  /** Brand palette, used by the placeholder provider. */
  palette?: string[];
}

export interface GeneratedImage {
  bytes: Buffer;
  contentType: string;
  seed: number;
}

export interface ImageResult {
  images: GeneratedImage[];
  model: string;
  /** Notes such as "seed not supported", shown to the user. */
  notes: string[];
}

export interface ImageProvider {
  id: string;
  label: string;
  models: string[];
  supportsSeed: boolean;
  supportsReferences: boolean;
  needsKey: boolean;
  generate(req: ImageRequest, apiKey: string | undefined): Promise<ImageResult>;
}

/** Stable 31-bit seed from any string (post id + slot), so re-runs ask for the same image. */
export function seedFrom(input: string): number {
  return createHash("sha256").update(input).digest().readUInt32BE(0) & 0x7fffffff;
}

export function composePrompt(style: string, subject: string): string {
  const s = style.trim().replace(/[.\s]+$/, "");
  const sub = subject.trim();
  return s ? `${sub}. Style: ${s}. No text, no lettering, no logos.` : `${sub}. No text, no lettering, no logos.`;
}

async function fetchBytes(url: string): Promise<Buffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Downloading the generated image failed (${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

async function check(r: Response, provider: string): Promise<unknown> {
  const text = await r.text();
  if (!r.ok) {
    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.error?.message ?? j.detail ?? j.message ?? msg;
    } catch {}
    throw new Error(`${provider} returned ${r.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`);
  }
  return JSON.parse(text);
}

function nearestAspect(w: number, h: number, options: string[]): string {
  const target = w / h;
  return options.reduce((best, o) => {
    const [a, b] = o.split(/[:x]/).map(Number);
    const [ba, bb] = best.split(/[:x]/).map(Number);
    return Math.abs(a / b - target) < Math.abs(ba / bb - target) ? o : best;
  });
}

/** OpenAI image generation (gpt-image-1). No seed control; references go through the edits endpoint. */
export const openaiProvider: ImageProvider = {
  id: "openai",
  label: "OpenAI (gpt-image)",
  models: ["gpt-image-1"],
  supportsSeed: false,
  supportsReferences: true,
  needsKey: true,
  async generate(req, key) {
    if (!key) throw new Error("Add an OpenAI API key in Settings to use this provider.");
    const model = req.model || "gpt-image-1";
    const size = nearestAspect(req.width, req.height, ["1024x1024", "1024x1536", "1536x1024"]);
    let r: Response;
    if (req.references?.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", req.prompt);
      form.set("n", String(req.n));
      form.set("size", size);
      req.references.slice(0, 4).forEach((b, i) => form.append("image[]", new Blob([new Uint8Array(b)], { type: "image/png" }), `ref${i}.png`));
      r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    } else {
      r = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: req.prompt, n: req.n, size }),
      });
    }
    const j = (await check(r, "OpenAI")) as { data: { b64_json?: string; url?: string }[] };
    const images = await Promise.all(
      j.data.map(async (d) => ({ bytes: d.b64_json ? Buffer.from(d.b64_json, "base64") : await fetchBytes(d.url!), contentType: "image/png", seed: req.seed })),
    );
    return { images, model, notes: ["OpenAI does not support seeds; the prompt is stored so the image can be regenerated, but it may differ."] };
  },
};

/** Google Imagen through the Gemini API. Seeds work when the watermark is off. */
export const googleProvider: ImageProvider = {
  id: "google",
  label: "Google (Imagen)",
  models: ["imagen-4.0-generate-001", "imagen-4.0-ultra-generate-001", "imagen-4.0-fast-generate-001"],
  supportsSeed: true,
  supportsReferences: false,
  needsKey: true,
  async generate(req, key) {
    if (!key) throw new Error("Add a Google AI (Gemini API) key in Settings to use this provider.");
    const model = req.model || "imagen-4.0-generate-001";
    const aspectRatio = nearestAspect(req.width, req.height, ["1:1", "3:4", "4:3", "9:16", "16:9"]);
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`, {
      method: "POST",
      headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt: req.prompt }],
        parameters: { sampleCount: Math.min(4, req.n), aspectRatio, seed: req.seed, addWatermark: false, ...(req.negativePrompt ? { negativePrompt: req.negativePrompt } : {}) },
      }),
    });
    const j = (await check(r, "Google")) as { predictions?: { bytesBase64Encoded: string; mimeType?: string }[] };
    const images = (j.predictions ?? []).map((p, i) => ({ bytes: Buffer.from(p.bytesBase64Encoded, "base64"), contentType: p.mimeType ?? "image/png", seed: req.seed + i }));
    if (!images.length) throw new Error("Google returned no images (the prompt may have been filtered).");
    return { images, model, notes: [] };
  },
};

/** Black Forest Labs FLUX through fal.ai. Exact sizes and seeds. */
export const fluxProvider: ImageProvider = {
  id: "flux",
  label: "FLUX (via fal.ai)",
  models: ["fal-ai/flux/dev", "fal-ai/flux-pro/v1.1", "fal-ai/flux-pro/v1.1-ultra"],
  supportsSeed: true,
  supportsReferences: false,
  needsKey: true,
  async generate(req, key) {
    if (!key) throw new Error("Add a fal.ai API key in Settings to use FLUX.");
    const model = req.model || "fal-ai/flux/dev";
    const w = Math.round(req.width / 16) * 16;
    const h = Math.round(req.height / 16) * 16;
    const r = await fetch(`https://fal.run/${model}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: req.prompt, image_size: { width: w, height: h }, seed: req.seed, num_images: Math.min(4, req.n), enable_safety_checker: true, output_format: "png" }),
    });
    const j = (await check(r, "fal.ai")) as { images: { url: string; content_type?: string }[]; seed?: number };
    const images = await Promise.all(j.images.map(async (im, i) => ({ bytes: await fetchBytes(im.url), contentType: im.content_type ?? "image/png", seed: (j.seed ?? req.seed) + i })));
    return { images, model, notes: [] };
  },
};

/** Ideogram v3. Seeds and negative prompts supported. */
export const ideogramProvider: ImageProvider = {
  id: "ideogram",
  label: "Ideogram",
  models: ["V_3"],
  supportsSeed: true,
  supportsReferences: true,
  needsKey: true,
  async generate(req, key) {
    if (!key) throw new Error("Add an Ideogram API key in Settings to use this provider.");
    const form = new FormData();
    form.set("prompt", req.prompt);
    form.set("aspect_ratio", nearestAspect(req.width, req.height, ["1x1", "4x5", "9x16", "16x9", "3x4", "4x3", "2x1"]));
    form.set("seed", String(req.seed));
    form.set("num_images", String(Math.min(4, req.n)));
    form.set("magic_prompt", "OFF");
    form.set("rendering_speed", "DEFAULT");
    if (req.negativePrompt) form.set("negative_prompt", req.negativePrompt);
    req.references?.slice(0, 3).forEach((b, i) => form.append("style_reference_images", new Blob([new Uint8Array(b)], { type: "image/png" }), `ref${i}.png`));
    const r = await fetch("https://api.ideogram.ai/v1/ideogram-v3/generate", { method: "POST", headers: { "Api-Key": key }, body: form });
    const j = (await check(r, "Ideogram")) as { data: { url: string; seed?: number }[] };
    const images = await Promise.all(j.data.map(async (d) => ({ bytes: await fetchBytes(d.url), contentType: "image/png", seed: d.seed ?? req.seed })));
    return { images, model: "V_3", notes: [] };
  },
};

/**
 * Offline provider: deterministic geometric artwork in the brand palette.
 * Same seed, same image. Useful without API keys, in tests and for text-led posts.
 */
export const placeholderProvider: ImageProvider = {
  id: "placeholder",
  label: "Brand pattern (offline, no key)",
  models: ["pattern-v1"],
  supportsSeed: true,
  supportsReferences: false,
  needsKey: false,
  async generate(req) {
    const palette = req.palette?.length ? req.palette : ["#2b2b2b", "#e6e1d8", "#8a8a8a"];
    const images: GeneratedImage[] = [];
    for (let i = 0; i < req.n; i++) {
      const seed = (req.seed + i) >>> 0;
      let s = seed || 1;
      const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
      const pick = () => palette[Math.floor(rnd() * palette.length)];
      const { width: w, height: h } = req;
      const cell = Math.round(Math.min(w, h) / (4 + Math.floor(rnd() * 4)));
      let shapes = `<rect width="${w}" height="${h}" fill="${pick()}"/>`;
      for (let y = 0; y < h; y += cell)
        for (let x = 0; x < w; x += cell) {
          const c = pick();
          const k = Math.floor(rnd() * 4);
          if (k === 0) shapes += `<rect x="${x}" y="${y}" width="${cell}" height="${cell}" fill="${c}"/>`;
          else if (k === 1) shapes += `<circle cx="${x + cell / 2}" cy="${y + cell / 2}" r="${cell / 2.4}" fill="${c}"/>`;
          else if (k === 2) shapes += `<path d="M${x} ${y + cell}L${x + cell} ${y}L${x + cell} ${y + cell}Z" fill="${c}"/>`;
          else shapes += `<rect x="${x + cell / 4}" y="${y + cell / 4}" width="${cell / 2}" height="${cell / 2}" transform="rotate(45 ${x + cell / 2} ${y + cell / 2})" fill="${c}"/>`;
        }
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${shapes}</svg>`;
      images.push({ bytes: await sharp(Buffer.from(svg)).png().toBuffer(), contentType: "image/png", seed });
    }
    return { images, model: "pattern-v1", notes: [] };
  },
};

export const IMAGE_PROVIDERS: Record<string, ImageProvider> = Object.fromEntries(
  [placeholderProvider, openaiProvider, googleProvider, fluxProvider, ideogramProvider].map((p) => [p.id, p]),
);

export function getImageProvider(id: string): ImageProvider {
  const p = IMAGE_PROVIDERS[id];
  if (!p) throw new Error(`Unknown image provider "${id}".`);
  return p;
}

/** Crops/resizes a generated image to the exact pixel size the template slot needs. */
export async function fitImage(bytes: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(bytes).resize(width, height, { fit: "cover", position: "attention" }).png().toBuffer();
}
