import { closeDb, getDb, runMigrations } from "@sme/db";
import { closeRenderer, seed } from "./index";

await runMigrations();
const r = await seed(getDb());
console.log(r.created ? `Seeded. Sign in as ${r.email} / ${"password" in r ? r.password : ""}` : `Already seeded (${r.email}).`);
await closeRenderer();
await closeDb();
