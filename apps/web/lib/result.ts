export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string; details?: unknown };
