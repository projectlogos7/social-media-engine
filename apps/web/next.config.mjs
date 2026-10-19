// One .env at the repo root serves the web app, the worker and the CLI scripts.
try {
  process.loadEnvFile(new URL("../../.env", import.meta.url).pathname);
} catch {}

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@sme/core", "@sme/db", "@sme/design", "@sme/engine", "@sme/generate", "@sme/knowledge", "@sme/publish", "@sme/render"],
  serverExternalPackages: ["playwright", "playwright-core", "sharp", "postgres", "@aws-sdk/client-s3", "linkedom", "handlebars", "@mozilla/readability", "pixelmatch", "pngjs", "fflate", "@anthropic-ai/sdk"],
  experimental: { serverActions: { bodySizeLimit: "60mb" } },
};
export default nextConfig;
