# Server-side image for Fly.io / any Docker host. Runs the Bun + Hono + WS
# server. The web app is served separately (Vercel), so apps/web is copied
# but not installed/run here — turbo workspaces resolve it as a peer package
# only if referenced, which the server doesn't do.
FROM oven/bun:1.3.11-alpine

WORKDIR /app

# Copy everything — .dockerignore excludes node_modules, .next, .turbo etc.
# so the image stays small.
COPY . .

# Install workspace dependencies (uses root bun.lock).
RUN bun install --frozen-lockfile

WORKDIR /app/apps/server

# Fly / Railway / Render will set $PORT; the server reads it.
EXPOSE 3001

CMD ["bun", "run", "src/server.ts"]
