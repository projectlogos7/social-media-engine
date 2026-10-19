import { NextResponse } from "next/server";
import type { Platform } from "@sme/core";
import { getDb } from "@sme/db";
import { startConnect } from "@sme/engine";
import { route } from "@/lib/api";

export const GET = route<{ params: Promise<{ platform: string }> }>(async (s, req, { params }) => {
  const { platform } = await params;
  const projectId = new URL(req.url).searchParams.get("projectId") ?? "";
  const url = await startConnect(getDb(), s.actor, projectId, platform as Platform);
  return NextResponse.redirect(url);
});
