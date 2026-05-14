# Agent guide

Conventions for working in this repo. Read this before making non-trivial changes. Living document — append decisions here when they're worth surviving the next session.

## Quick orient

- `apps/web` — Next.js 16, oRPC, Better Auth + SIWE. Renders the visualizer.
- `apps/server` — Bun + Hono + native WebSocket. Owns the live `Session`, fal generation, STT, song recognition, credit gating. Runs Drizzle migrations on boot.
- `packages/api` — generic oRPC primitives, the shared `sessionRouter`, the WS bridge.
- `packages/db` — Drizzle schema (`auth.db.ts`, `credits.db.ts`), migrations folder, `createDb` + `runMigrations` helpers. Owned by both apps.
- `packages/shared` — zod schemas, types, `typeid`, `ws-ticket` HMAC, pricing.
- `packages/test-utils` — pglite helper.

## Production

Deployed on **Railway** (Postgres template + two app services). Any `DATABASE_URL` in `apps/web/.env` / `apps/server/.env` is local-dev only — it points at a `bun run db:start` Postgres on `localhost:54324`, **not what production runs against**. Railway injects the prod DB URL at runtime via `${{Postgres.DATABASE_URL}}`; the server reads it from `env.DATABASE_URL` and applies `packages/db` migrations on every boot.

### Project

- **Name**: `fearless-nourishment`
- **ID**: `33e35438-b78d-4cf9-8fe6-d0ba87e3c111`
- **Dashboard**: https://railway.com/project/33e35438-b78d-4cf9-8fe6-d0ba87e3c111

### Services

| Service | Public domain | Service ID | Role |
|---|---|---|---|
| `web` | https://web-production-53719.up.railway.app | `235aa1d4-8c1b-4b7a-989a-099e61807e8c` | Next.js standalone; HTTP `/`, `/rpc/*`, `/api/auth/*` |
| `server` | https://server-production-2f7a.up.railway.app | `12262832-9534-4230-b032-c675d87f29b8` | Bun + Hono; HTTP `/health`, `/rpc/*`, WS `/ws` |
| `Postgres` | `postgres.railway.internal:5432` (private) | n/a (Railway template) | auth + credits ledger |

### CLI (already installed + authenticated locally)

```bash
railway status                           # current project + service health
railway logs --service server -n 100     # pino structured logs (server or web)
railway variables --service server --kv  # env vars set on a service
railway redeploy --service server --yes  # redeploy latest deployment, no rebuild
railway run --service web -- <cmd>       # run a local command with Railway env vars injected
railway service Postgres && railway connect  # psql tunnel to the prod DB
```

Bash invocations of `railway status:*`, `railway logs:*`, `railway variables:*`, `railway whoami`, `railway list`, `railway link:*`, `railway service` are pre-approved in `.claude/settings.local.json` — they don't need per-session permission. Destructive commands (`redeploy`, `down`, `delete`, `run -- …`) still gate on user approval.

Railway local MCP is registered in `.mcp.json` (gitignored). Future agents pick up `mcp__railway__*` tools automatically; falls back to CLI if MCP isn't initialized.

### Schema migrations

Migrations live in `packages/db/drizzle/` (not `apps/web/drizzle/` — that path is stale-doc). After editing `packages/db/src/schema/*.db.ts`:

```bash
bun run --filter=@sonara/db db:generate
```

Commit the new SQL file. The next deploy applies it automatically via `runMigrations()` called at `apps/server/src/server.ts` startup. **Never run `db:push` against prod.** No production `db:push` script exists.

See `DEPLOY.md` for the from-scratch wiring procedure (project create, service create, variable wiring, build-args vs runtime env). See `INFRASTRUCTURE.md` for topology diagrams and external-integration cheat-sheet.

## Build & run

```bash
bun install
bun run dev            # web + server in parallel via turbo
bun run dev:web        # web only
bun run dev:server     # server only
bun run typecheck      # all 6 packages
bun run lint           # oxlint
bun run test           # turbo test
bun run ci:local       # lint → typecheck → test → build (serial)
```

Web on `http://localhost:4470`, server on `ws://localhost:4471/ws`.

## Database

Schema and migrations live in `packages/db`. The server applies pending migrations on every boot via `runMigrations()` (see `apps/server/src/server.ts`) — there is no manual `db:push` step in dev or prod.

Local Postgres comes from `packages/db/docker-compose.yml` (Postgres 17 on `localhost:54324`). Bring it up with `bun run db:start`; stop it with `bun run db:stop` (volume persists) or `bun run db:down` (containers removed, volume kept). `bun run --filter=@sonara/db db:clean` wipes the volume.

To author a new migration:

```bash
# After editing packages/db/src/schema/*.db.ts
bun run --filter=@sonara/db db:generate
```

This produces a new SQL file in `packages/db/drizzle/`. Commit it alongside the schema change so history stays in lockstep. Server boots will apply it automatically on the next deploy.

**Never auto-run** `db:migrate` — the user runs it manually if they need to apply outside of a deploy.

## Error handling

Throw `ORPCError(code, { message })` from routers and the WS session procedures. Codes used in this repo: `BAD_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `INTERNAL_SERVER_ERROR`. Do not introduce custom codes.

Services (`*-service.ts`) may `throw new Error(...)`. The router catches and re-wraps. We do not use `Result<T, E>` / neverthrow or tagged-error registries — the throw-site count is small and `ORPCError` round-trips cleanly to the client.

## File naming

- `*.router.ts` — oRPC routers (one per domain).
- `*.service.ts` — server-side service modules.
- `*.test.ts` — co-located with the file under test.
- `*.db.ts` — Drizzle table definitions (post-split).

## Procedure pattern

Two definitions, on purpose — do not deduplicate:

- `packages/api/src/api.ts` — generic `publicProcedure` / `protectedProcedure` parameterised by `WebContext`. Used for the shared `sessionRouter`.
- `apps/web/src/server/rpc/procedures.ts` — concrete `publicProcedure` / `protectedProcedure` narrowed to the web app's `Database` type. Used for `auth.router.ts`, `credits.router.ts`, etc.

The duplication exists so each app can supply its own context shape without leaking concrete types across the package boundary. Mirrors the pattern in `~/Code/github-com/invok/apps/admin-api/src/procedures.ts`.

## State ownership

- **Server-authoritative** — the live scene, voice intent atmosphere, credit state, version counters. Lives in `apps/server/src/session/session.ts` (`Session` class) and is broadcast via the `eventIterator` subscription.
- **Client UI state** — preset selection, panel visibility, voice trail UI, inspector HUD. Lives in `apps/web/src/stores/visualizer-store.ts` (zustand).

Voice intent is duplicated by design: the `VoiceController` on the server owns dispatch + debouncing; the client store owns the trail UI. Don't try to unify them.

## Auth

Two methods on the same Better Auth instance (`apps/web/src/server/auth.ts`), one session cookie, read by `protectedProcedure` middleware.

1. **SIWE wallet** (open): Reown AppKit → Better Auth `siwe` plugin. Anonymous mode — any wallet that signs the SIWE message gets a user row with synthetic email `<addr>@wallet.<host>`. ERC-1271 + ERC-6492 verification via the Reown-tuned mainnet client in `apps/web/src/lib/chain-clients.ts`.
2. **Email + password** (allowlist-gated): Better Auth's built-in `emailAndPassword`. Signup is rejected by `databaseHooks.user.create.before` unless the email exists in the `allowed_email` table. Add an email with `bun run --filter=web allow-email <address> [note]`. UI lives at `/login`.

For the WebSocket: the web app mints a 5-min HMAC ticket via `auth.mintWsTicket`; the browser opens `ws://server/ws?token=…`; the server verifies the ticket via `verifyTicket` from `@sonara/shared`. The ticket path is auth-method-agnostic — both SIWE and email-password users get the same ticket.

## Credits & money path

- `apps/server/src/credits/credits.service.ts` — atomic `debitFrame` / `tryConsumeFreeTier` / `refundFrame` / `getBalance`. Direct `pg` queries; no Drizzle dependency in apps/server.
- `apps/web/src/server/rpc/credits.router.ts` — `getBalance` + `confirmTopUp` (viem-verified USDC receipt on Base, idempotent via `tx_hash` unique index).
- `apps/server/src/session/session.ts` — credit gate at the trigger site. BYOK fal key bypasses the gate entirely.

Pricing in `packages/shared/src/pricing.ts` — single source of truth for both UI and server.

## Demo image library

Pre-generated, deck-organised images that bypass fal during client demos. Zero per-frame cost, zero latency, no credit debit. Bound by an explicit DEMO toggle in the controls panel — never auto-engaged.

- **Schema**: `packages/db/src/schema/image-library.db.ts`. Indexes: `(deck, status)` btree + `prompt_hash` unique. `status` is `"active" | "rejected"` — curation is manual SQL today (`UPDATE image_library SET status='rejected' WHERE id = …`); no `/dev` page.
- **Deck registry**: `packages/shared/src/decks.ts` is the single source of deck keys + display labels. Adding a deck is one entry + a manifest section.
- **Server pick path**: `apps/server/src/generation/library-provider.ts → pickLibraryFrame(deck, excludeIds, logger)`. Raw `pg` via `apps/server/src/db/pool.ts` (also used by `credits.service.ts`). LRU is 10 typeids tracked on `Session`.
- **Trigger bypass**: `Session.trigger()` short-circuits to `triggerLibrary()` at the very top when `demoMode && demoDeck`. Bypasses the empty-subject guard, credit gate, resolver, and fal entirely. Empty deck → emits a `job.status` `error` with a friendly toast message; **does not** silently fall back to fal.
- **Toggle plumbing**: oRPC `session.setDemoMode` (`packages/api/src/routers/session.router.ts`). Client store: `apps/web/src/stores/visualizer/demo-slice.ts` (localStorage-persisted). On every `socket.open`, `useWsSession` re-pushes `{demoMode, demoDeck}` so a refresh keeps the demo running. `setDemoMode` clears `heroImageUrl` + the LRU on every toggle, and fires an instant first frame on demo-on.
- **Assets**: WebPs live under `apps/web/public/library/<deck>/<typeid>.webp` and ship with the Next build. Database `url` column stores the relative path — same on dev and prod.
- **Seeding fresh prompts** (calls fal): `cd apps/server && bun run seed:library` (optionally `--deck <key> --limit <n> --model <id> --dry-run`). Re-runs are idempotent via `sha256(deck::prompt)` in `prompt_hash`.
- **Seeding from the committed export** (no fal, replay-safe): `bun run export:library` after a fal seed dumps `apps/server/scripts/library-seed.json` (commit it). `bun run seed:library -- --from-export` replays it. Production fill-up: `railway run --service server -- bun run scripts/seed-library.ts -- --from-export`.

## Don't touch

- `apps/web/src/components/visualizer/canvas/displacement-canvas.tsx` (~900 LOC) — tightly-coupled WebGL2 state.
- `apps/web/src/components/visualizer/canvas/displacement-shaders.ts` (~820 LOC) — monolithic GLSL with documented passes.

These read better as single files. Resist the urge to "decompose for clarity" — the cost of cross-file shader refactors outweighs any ergonomic win.

Voice handling currently lives inline in `apps/server/src/session/session.ts`. An earlier extraction to `voice-controller.ts` was reverted. See `ARCHITECTURE.md` smell #1 for the broader `Session` size story.

## Out of scope (anti-patterns for this project)

These exist in reference projects (`invok`, `appmisha.com`) and are deliberately NOT adopted here:

- Tagged-error registries (`errore`).
- `Result<T, ServiceError>` / neverthrow + `unwrapOrThrow`.
- Admin or internal procedure tiers — there are no admin endpoints.
- Feature folders (`features/admin/{domain}`) — the flat `rpc/` layout is fine for one-app scope.
- `*.relations.ts` files — relations are a few lines, co-locate with the table.
- Multi-tenancy, orgs, i18n, Redis queue, OTel, separate admin app.
- Catalog dependency pinning — five devDeps, not worth it.

## When working with Claude Code

- Create a `Task` for non-trivial work; mark each task complete as you finish it (don't batch).
- Prefer editing existing files over creating new ones.
- For UI changes, run the dev server and verify in the browser before claiming done.
- Don't write new docs unless asked. Update this file when a convention solidifies.
