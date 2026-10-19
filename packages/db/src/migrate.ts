import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "./client";

export const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export async function runMigrations() {
  await migrate(getDb(), { migrationsFolder: MIGRATIONS_DIR });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => console.log("Migrations applied."))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(closeDb);
}
