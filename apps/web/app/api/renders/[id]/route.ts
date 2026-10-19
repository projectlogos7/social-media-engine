import { getDb } from "@sme/db";
import { getRenderFile } from "@sme/engine";
import { fileResponse, route } from "@/lib/api";

export const GET = route<{ params: Promise<{ id: string }> }>(async (s, req, { params }) => {
  const { id } = await params;
  const { bytes } = await getRenderFile(getDb(), s.actor, id);
  const download = new URL(req.url).searchParams.get("download");
  return fileResponse(bytes, "image/png", { immutable: true, filename: download ? `${download}.png` : undefined });
});
