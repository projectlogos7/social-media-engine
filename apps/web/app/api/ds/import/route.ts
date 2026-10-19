import { NextResponse } from "next/server";
import { getDb } from "@sme/db";
import { EngineError, parseUpload, publishDesignSystemVersion, saveDesignSystemVersion } from "@sme/engine";
import { route } from "@/lib/api";

/** Accepts a zip, the design system's one-file HTML, or a folder (files[] + paths[]). */
export const POST = route(async (s, req) => {
  const form = await req.formData();
  const projectId = String(form.get("projectId"));
  const note = String(form.get("note") ?? "");
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const paths = form.getAll("paths").map(String);
  if (!files.length) throw new EngineError("Choose the design system export to upload.");
  let bundle;
  if (files.length === 1 && /\.zip$/i.test(files[0].name)) bundle = parseUpload({ zip: new Uint8Array(await files[0].arrayBuffer()) });
  else if (files.length === 1 && /\.html?$/i.test(files[0].name)) bundle = parseUpload({ html: await files[0].text() });
  else {
    const map = new Map<string, Uint8Array>();
    for (const [i, f] of files.entries()) map.set(paths[i] || f.name, new Uint8Array(await f.arrayBuffer()));
    bundle = parseUpload({ files: map });
  }
  const version = await saveDesignSystemVersion(getDb(), s.actor, projectId, bundle, note);
  if (form.get("publish") === "1") await publishDesignSystemVersion(getDb(), s.actor, version.id);
  return NextResponse.json({ versionId: version.id, version: version.version, name: version.name, warnings: bundle.warnings, assets: bundle.assets.length, fonts: bundle.fonts.length, components: bundle.components.map((c) => c.name) });
});
