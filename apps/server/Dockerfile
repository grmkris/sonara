# syntax=docker/dockerfile:1.7
#
# apps/server — Bun + Hono + WebSocket.
#
# Build from the repo root (context must include the full workspace so bun
# can resolve workspace:* deps):
#   docker build -f apps/server/Dockerfile -t mv-server .
#
# Run:
#   docker run --rm -p 4471:4471 \
#     -e BETTER_AUTH_SECRET=... -e DATABASE_URL=... \
#     -e FAL_KEY=... -e AUDD_API_KEY=... \
#     mv-server
#
# On Railway: auto-detected when set as the service Dockerfile. Railway
# injects $PORT at runtime; Bun.serve picks it up via env.PORT.

# ---- builder ----------------------------------------------------------------
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# Copy all workspace manifests + the shared lockfile so `bun install` can
# resolve every workspace:* edge. Copying package.json files before sources
# keeps the install layer cacheable across source edits.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/api/package.json ./packages/api/
COPY packages/db/package.json ./packages/db/
COPY packages/logger/package.json ./packages/logger/
COPY packages/shared/package.json ./packages/shared/
COPY packages/test-utils/package.json ./packages/test-utils/

RUN bun install --no-summary

# Source. Only what the server actually needs at runtime — apps/web is a
# peer workspace but the server never imports it, so we skip it for a
# smaller image. packages/db carries the migrations folder applied on boot.
COPY apps/server ./apps/server
COPY packages/api ./packages/api
COPY packages/db ./packages/db
COPY packages/logger ./packages/logger
COPY packages/shared ./packages/shared

# ---- runtime ---------------------------------------------------------------
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Bun runs TypeScript directly — no build step needed. Copy the whole
# tree from builder so workspace resolution keeps working (bun resolves
# workspace:* via the root node_modules symlinks).
COPY --from=builder /app /app

WORKDIR /app/apps/server

EXPOSE 4471

# Liveness probe against /health (Hono route in src/server.ts). Railway
# overrides this via railway.toml's healthcheckPath; this is for local
# docker run only.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||4471)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "src/server.ts"]
