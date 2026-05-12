# Agent guide

Conventions for working in this repo. Read this before making non-trivial changes. Living document — append decisions here when they're worth surviving the next session.

## Quick orient

- `apps/web` — Next.js 16, oRPC, Better Auth + SIWE. Renders the visualizer.
- `apps/server` — Bun + Hono + native WebSocket. Owns the live `Session`, fal generation, STT, song recognition, credit gating. Runs Drizzle migrations on boot.
- `packages/api` — generic oRPC primitives, the shared `sessionRouter`, the WS bridge.
- `packages/db` — Drizzle schema (`auth.db.ts`, `credits.db.ts`), migrations folder, `createDb` + `runMigrations` helpers. Owned by both apps.
- `packages/shared` — zod schemas, types, `typeid`, `ws-ticket` HMAC, pricing.
- `packages/test-utils` — pglite helper.

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

To author a new migration:

```bash
# After editing packages/db/src/schema/*.db.ts
bun run --filter=@music-visualizer/db db:generate
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

SIWE via Better Auth (`apps/web/src/server/auth.ts`) → web session cookie → `protectedProcedure` middleware reads it.

For the WebSocket: the web app mints a 5-min HMAC ticket via `auth.mintWsTicket`; the browser opens `ws://server/ws?token=…`; the server verifies the ticket via `verifyTicket` from `@music-visualizer/shared`. ERC-1271 + ERC-6492 verification happens through the Reown-tuned mainnet client in `apps/web/src/lib/chain-clients.ts`.

## Credits & money path

- `apps/server/src/credits/credits-service.ts` — atomic `debitFrame` / `tryConsumeFreeTier` / `refundFrame` / `getBalance`. Direct `pg` queries; no Drizzle dependency in apps/server.
- `apps/web/src/server/rpc/credits.router.ts` — `getBalance` + `confirmTopUp` (viem-verified USDC receipt on Base, idempotent via `tx_hash` unique index).
- `apps/server/src/session/session.ts` — credit gate at the trigger site. BYOK fal key bypasses the gate entirely.

Pricing in `packages/shared/src/pricing.ts` — single source of truth for both UI and server.

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
