import "server-only";
import { NextResponse } from "next/server";
import { EngineError } from "@sme/engine";
import { currentSession } from "./session";
import type { SessionInfo } from "@sme/engine";

/** Wraps a route handler: requires a session, maps engine errors to JSON responses. */
export function route<C>(fn: (s: SessionInfo, req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    const s = await currentSession();
    if (!s) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    try {
      return await fn(s, req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function errorResponse(e: unknown) {
  if (e instanceof EngineError) return NextResponse.json({ error: e.message, details: e.details }, { status: e.status });
  console.error(e);
  return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

export function fileResponse(bytes: Uint8Array, contentType: string, opts: { filename?: string; immutable?: boolean } = {}) {
  const headers: Record<string, string> = { "Content-Type": contentType, "Cache-Control": opts.immutable ? "private, max-age=31536000, immutable" : "private, no-cache" };
  if (contentType === "image/svg+xml") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  if (opts.filename) headers["Content-Disposition"] = `attachment; filename="${opts.filename.replace(/"/g, "")}"`;
  return new Response(new Uint8Array(bytes), { headers });
}
