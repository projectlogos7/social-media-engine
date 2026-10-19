import { getDb } from "@sme/db";
import { getAsset } from "@sme/engine";
import { fileResponse, route } from "@/lib/api";

export const GET = route<{ params: Promise<{ id: string }> }>(async (s, _req, { params }) => {
  const { id } = await params;
  const { asset, bytes } = await getAsset(getDb(), s.actor, id);
  return fileResponse(bytes, asset.contentType, { immutable: true });
});
