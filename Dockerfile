# One image runs the web app and the job worker (set RUN_WORKER=false on the web
# container and run `pnpm worker` in a second one to split them).
FROM mcr.microsoft.com/playwright:v1.56.1-noble

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DATA_DIR=/data
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
COPY fixtures ./fixtures
RUN pnpm install --frozen-lockfile && pnpm --filter @sme/web build

VOLUME /data
EXPOSE 3000
CMD ["sh", "-c", "pnpm db:migrate && pnpm --filter @sme/web start"]
