import { NextResponse } from "next/server";
import type { Platform } from "@sme/core";
import { getDb } from "@sme/db";
import { appUrl, finishConnect } from "@sme/engine";
import { currentSession } from "@/lib/session";

export async function GET(req: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const q = new URL(req.url).searchParams;
  const s = await currentSession();
  if (!s) return NextResponse.redirect(`${appUrl()}/login`);
  if (q.get("error")) return NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent(q.get("error_description") ?? q.get("error") ?? "Connection cancelled")}`);
  try {
    const r = await finishConnect(getDb(), s.actor, platform as Platform, q.get("state") ?? "", q.get("code") ?? "");
    return NextResponse.redirect(`${appUrl()}/p/${r.projectId}/publish?connected=${r.channelIds.length}`);
  } catch (e) {
    return NextResponse.redirect(`${appUrl()}/?error=${encodeURIComponent((e as Error).message)}`);
  }
}
