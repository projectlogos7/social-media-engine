import { getDb, verifySignature } from "@sme/db";
import { getRenderFile } from "@sme/engine";
import { fileResponse } from "@/lib/api";

/** Signed, expiring public link: Instagram fetches images from here. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sig = new URL(req.url).searchParams.get("sig") ?? "";
  if (!verifySignature(`render:${id}`, sig)) return new Response("Link expired", { status: 403 });
  try {
    const { bytes } = await getRenderFile(getDb(), null, id);
    return fileResponse(bytes, "image/png");
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
