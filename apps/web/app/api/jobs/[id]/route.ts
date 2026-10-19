import { NextResponse } from "next/server";
import { getDb } from "@sme/db";
import { getJob } from "@sme/engine";
import { route } from "@/lib/api";

export const GET = route<{ params: Promise<{ id: string }> }>(async (s, _req, { params }) => {
  const { id } = await params;
  return NextResponse.json(await getJob(getDb(), s.actor, id));
});
