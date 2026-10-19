import { NextResponse } from "next/server";
import type { FormatId, SlotValues } from "@sme/core";
import { getDb } from "@sme/db";
import { previewTemplate } from "@sme/engine";
import { route } from "@/lib/api";

export const POST = route(async (s, req) => {
  const body = (await req.json()) as { projectId: string; spec: unknown; format: FormatId; slots?: SlotValues };
  const r = await previewTemplate(getDb(), s.actor, body.projectId, body.spec, body.format, body.slots);
  return NextResponse.json({ png: `data:image/png;base64,${r.png.toString("base64")}`, report: r.report, lint: r.lint });
});
