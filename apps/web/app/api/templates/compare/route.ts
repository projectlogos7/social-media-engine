import { NextResponse } from "next/server";
import { getDb } from "@sme/db";
import { compareToGolden } from "@sme/engine";
import { route } from "@/lib/api";

const uri = (b: Buffer) => `data:image/png;base64,${b.toString("base64")}`;

export const POST = route(async (s, req) => {
  const body = (await req.json()) as { versionId: string; spec?: unknown };
  const r = await compareToGolden(getDb(), s.actor, body.versionId, body.spec);
  return NextResponse.json({ results: r.map((x) => ({ format: x.format, ratio: x.ratio, diffPixels: x.diffPixels, before: uri(x.before), after: uri(x.after), diff: uri(x.diff) })) });
});
