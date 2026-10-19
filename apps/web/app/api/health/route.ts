import { sql } from "drizzle-orm";
import { getDb } from "@sme/db";

export async function GET() {
  await getDb().execute(sql`select 1`);
  return Response.json({ ok: true });
}
