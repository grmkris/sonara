# syntax=docker/dockerfile:1.7
#
# apps/web — Next.js (standalone output) on Bun.
#
# Build from the repo root (workspace deps need the full context):
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_WS_URL=wss://your-server.up.railway.app/ws \
#     -t mv-web .
#
# Run (thin frontend — no DB, no secrets; auth/RPC live on the server behind
# the gateway). Reached internally by the gateway at web.railway.internal:PORT:
#   docker run --rm -p 4472:4472 -e PORT=4472 \
#     -e RPC_INTERNAL_URL=http://localhost:4471 \
#     mv-web
#
# Next.js standalone mode emits a self-contained server at
# .next/standalone/ — we copy it plus .next/static and public into the
# runtime stage to keep the image small.

# ---- builder ----------------------------------------------------------------
FROM oven/bun:1.3.14 AS builder
WORKDIR /app

# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, so
# they must be present here. Railway passes them via service build args.
ARG NEXT_PUBLIC_WS_URL=ws://localhost:4471/ws
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}

# Enables the react-grab dev overlay on a public build (the dev environment).
# Left empty for prod so the <Script> is never emitted. NODE_ENV=development
# (local) enables it regardless of this flag.
ARG NEXT_PUBLIC_ENABLE_DEVTOOLS=
ENV NEXT_PUBLIC_ENABLE_DEVTOOLS=${NEXT_PUBLIC_ENABLE_DEVTOOLS}

# Workspace manifests + lockfile → install once. Cacheable across source
# edits.
COPY package.json bun.lock turbo.json tsconfig.base.json ./
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
COPY packages/api/package.json ./packages/api/
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY packages/test-utils/package.json ./packages/test-utils/

RUN bun install --no-summary

# Sources needed to build web: apps/web plus the workspace packages it
# imports (shared + api). apps/server is copied for its TYPE export only —
# web does `import type { AppRouterClient } from "server/rpc"`, which tsc must
# resolve at build time; `import type` is erased so no server code ships. db
# is a transitive type dep of that router type.
COPY apps/web ./apps/web
COPY apps/server ./apps/server
COPY packages/api ./packages/api
COPY packages/db ./packages/db
COPY packages/shared ./packages/shared

# Build. next.config.ts sets output: "standalone" so this emits a
# self-contained server bundle at apps/web/.next/standalone.
RUN cd apps/web && bun run build

# ---- runtime ---------------------------------------------------------------
FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Next.js standalone output includes only the files the server actually
# needs. Static assets + public dir are separate and must be copied
# alongside the standalone server.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The standalone output places server.js at apps/web/server.js with the
# workspace layout preserved.
CMD ["bun", "apps/web/server.js"]
