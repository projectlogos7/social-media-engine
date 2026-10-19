import { NextResponse } from "next/server";
import { getDb } from "@sme/db";
import { uploadAsset } from "@sme/engine";
import { route } from "@/lib/api";

export const POST = route(async (s, req) => {
  const form = await req.formData();
  const projectId = String(form.get("projectId"));
  const out = [];
  for (const f of form.getAll("files")) {
    if (!(f instanceof File)) continue;
    const a = await uploadAsset(getDb(), s.actor, projectId, Buffer.from(await f.arrayBuffer()), f.name);
    out.push({ id: a.id, name: a.name });
  }
  return NextResponse.json({ assets: out });
});
