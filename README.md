# Music Visualizer — Dreamlike Realtime AI

Browser-based visualizer. Text prompt, voice, or playing audio → continuously flowing, dreamlike AI-generated visuals. fal.ai FLUX.2 supplies keyframes; a WebGL2 displacement shader + feedback FBO carries continuity between them at 60 fps, driven by live audio features.

## Stack

- **Web** (`apps/web`): Next.js 16, React 19, Tailwind v4, shadcn/ui, zustand, framer-motion, Meyda
- **Server** (`apps/server`): Bun + Hono + native `Bun.serve` WebSocket, `@fal-ai/client`, pino
- **Shared** (`packages/shared`): zod schemas + TS types for all events and state
- **API** (`packages/api`): oRPC routers — HTTP `/rpc` (credits, auth) + WebSocket `/ws` session surface
- **Test utils** (`packages/test-utils`): pglite helper for db-backed tests

## Run

```bash
cp .env.example .env
# required: FAL_KEY, AUDD_API_KEY, BETTER_AUTH_SECRET, DATABASE_URL

bun install
bun run dev
```

- Web: http://localhost:4470
- Server: ws://localhost:4471/ws

## Scripts

- `bun run dev` — both apps in parallel (Turborepo)
- `bun run dev:web` — web only
- `bun run dev:server` — server only
- `bun run typecheck` — strict TS across the workspace
- `bun run lint` — oxlint across the workspace
- `bun run ci:local` — lint + typecheck + test + build serially
- `bun run db:start` / `db:stop` / `db:down` / `db:watch` — local Postgres via Docker

## Local Postgres

The server's `runMigrations()` and the credits + auth queries need a local Postgres in dev. A Postgres 17 service is defined in `packages/db/docker-compose.yml` (port `54324`, named volume for persistence):

```bash
bun run db:start    # docker compose up -d
bun run db:stop     # stop without removing the volume
bun run db:down     # stop + remove containers (volume kept)
bun run db:watch    # foreground tail
```

The default `DATABASE_URL` in `.env.example` points at this instance. Production uses Railway Postgres (see `AGENTS.md` §Production).

## Migrations

Drizzle schema and migrations live in `packages/db`. After editing `packages/db/src/schema/*.db.ts`:

```bash
bun run --filter=@music-visualizer/db db:generate
```

This writes a new SQL file to `packages/db/drizzle/`. Commit it alongside the schema change. The server applies pending migrations on every boot via `runMigrations()` — no manual `db:push` or `db:migrate` step in dev or prod.

## Architecture

See `ARCHITECTURE.md` for the current code tour — data flow, layer-by-layer map, and the tracked cleanup list. `INFRASTRUCTURE.md` is the deployment + topology map. `AGENTS.md` documents repo conventions for human + AI contributors.

**In short:** the browser captures audio (file / mic / tab share), extracts ~15 features via Meyda + a hand-rolled analyzer at 60 Hz, upstreams them at 5 Hz over an oRPC WebSocket. The server session runs scene / voice-intent / song-recognition / credits logic and pushes frame URLs + state updates back through an `eventIterator`. The client renders via a WebGL2 displacement shader with feedback FBO, Kuwahara painterly pass, and reveal-from-noise gate.

## Scope

**Shipped:** text prompts, browser-speech voice → Gemini intent parser, tab-audio / mic capture, AudD-backed song recognition with Apple Music enrichment, WebGL2 renderer with 21 presets + 13 shader primitives, LFO drift, FBO feedback, preset cross-fade, single-frame `streamPreview` per trigger, BYOK fal key, SIWE wallet auth + credit ledger + USDC top-ups on Base.

**Deferred:** OpenAI refine pass (original Phase 2 goal; not started). Fluid-sim preset (additive, not cleanup). See `ARCHITECTURE.md` smell list for the open cleanup items.
