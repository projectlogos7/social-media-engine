import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

export interface VisualDiff {
  diffPixels: number;
  ratio: number;
  diffPng: Buffer;
  sameSize: boolean;
}

/** Pixel diff between two PNGs (golden snapshots, re-render comparisons). */
export function visualDiff(a: Buffer, b: Buffer, threshold = 0.02): VisualDiff {
  const pa = PNG.sync.read(a);
  const pb = PNG.sync.read(b);
  if (pa.width !== pb.width || pa.height !== pb.height) return { diffPixels: pa.width * pa.height, ratio: 1, diffPng: b, sameSize: false };
  const out = new PNG({ width: pa.width, height: pa.height });
  const n = pixelmatch(pa.data, pb.data, out.data, pa.width, pa.height, { threshold, includeAA: false });
  return { diffPixels: n, ratio: n / (pa.width * pa.height), diffPng: PNG.sync.write(out), sameSize: true };
}
