/** Runs the job worker inside the web process unless RUN_WORKER=false (then run `pnpm worker` separately). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
