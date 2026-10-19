import sharp from "sharp";
import { deltaE, parseColor } from "@sme/core";

export interface PaletteReport {
  /** Dominant colours of the image, most common first. */
  dominant: { hex: string; share: number }[];
  /** Share-weighted average distance (CIEDE2000) of dominant colours to the nearest brand colour. */
  distance: number;
}

/** How far an image's dominant colours sit from the brand palette. */
export async function paletteReport(image: Buffer, palette: string[]): Promise<PaletteReport> {
  const { data, info } = await sharp(image).removeAlpha().resize(48, 48, { fit: "cover" }).raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < info.width * info.height * 3; i += 3) {
    const key = `${data[i] >> 5}-${data[i + 1] >> 5}-${data[i + 2] >> 5}`;
    const b = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += data[i];
    b.g += data[i + 1];
    b.b += data[i + 2];
    buckets.set(key, b);
  }
  const total = info.width * info.height;
  const dominant = [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 6)
    .map((b) => ({ rgb: [b.r / b.n, b.g / b.n, b.b / b.n] as [number, number, number], share: b.n / total }));
  const pal = palette.map((h) => parseColor(h)).filter(Boolean).map((c) => [c![0], c![1], c![2]] as [number, number, number]);
  let weighted = 0;
  let shares = 0;
  for (const d of dominant) {
    const nearest = pal.length ? Math.min(...pal.map((p) => deltaE(d.rgb, p))) : 0;
    weighted += nearest * d.share;
    shares += d.share;
  }
  const hex = (c: [number, number, number]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  return { dominant: dominant.map((d) => ({ hex: hex(d.rgb), share: +d.share.toFixed(3) })), distance: shares ? +(weighted / shares).toFixed(1) : 0 };
}
