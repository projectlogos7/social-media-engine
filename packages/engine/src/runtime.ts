import { Renderer } from "@sme/render";

const g = globalThis as unknown as { __smeRenderer?: Promise<Renderer> };

/** One headless browser per process, launched on first use. */
export function getRenderer(): Promise<Renderer> {
  if (!g.__smeRenderer) {
    g.__smeRenderer = Renderer.launch({ concurrency: Number(process.env.RENDER_CONCURRENCY ?? 3) }).catch((e) => {
      g.__smeRenderer = undefined;
      throw e;
    });
  }
  return g.__smeRenderer;
}

export async function closeRenderer() {
  if (g.__smeRenderer) {
    const r = await g.__smeRenderer;
    g.__smeRenderer = undefined;
    await r.close();
  }
}

/** Small LRU for immutable things (design-system runtimes, image data URIs). */
export class Lru<K, V> {
  private map = new Map<K, V>();
  constructor(private max: number) {}
  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  set(k: K, v: V) {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as K);
  }
}
