import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

const g = globalThis as unknown as { __smeDb?: { db: DB; sql: postgres.Sql } };

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://sme:sme@127.0.0.1:5432/sme";
}

/** One pooled connection per process (survives Next.js hot reloads). */
export function getDb(): DB {
  if (!g.__smeDb) {
    const sql = postgres(databaseUrl(), { max: Number(process.env.DB_POOL ?? 10), onnotice: () => {} });
    g.__smeDb = { db: drizzle(sql, { schema }), sql };
  }
  return g.__smeDb.db;
}

export async function closeDb() {
  if (g.__smeDb) {
    await g.__smeDb.sql.end();
    g.__smeDb = undefined;
  }
}
