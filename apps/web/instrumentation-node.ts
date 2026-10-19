import { getDb } from "@sme/db";
import { runWorker } from "@sme/engine";

const g = globalThis as unknown as { __smeWorker?: boolean };
if (process.env.RUN_WORKER !== "false" && !g.__smeWorker) {
  g.__smeWorker = true;
  void runWorker(getDb(), { concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) }).catch((e) => console.error("[worker] stopped", e));
  console.log("[worker] running in the web process");
}
