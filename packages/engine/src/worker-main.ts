import { closeDb, getDb, runMigrations } from "@sme/db";
import { closeRenderer, runWorker } from "./index";

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    console.log("Stopping worker…");
    controller.abort();
  });

await runMigrations();
console.log("Worker started.");
await runWorker(getDb(), { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2), signal: controller.signal });
await closeRenderer();
await closeDb();
