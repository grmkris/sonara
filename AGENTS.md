# Agent guide

Conventions for working in this repo. Read this before making non-trivial changes. Living document — append decisions here when they're worth surviving the next session.

## Quick orient

- `apps/gateway` — Caddy reverse proxy (`caddy:2-alpine`). The single public entry. Path-routes `/api/auth/*`, `/rpc/*`, `/api/upload/*`, `/ws` to the server and everything else to web, over `*.railway.internal`. So the browser sees one origin → cookies first-party, no CORS.
- `apps/web` — Next.js 16, thin frontend. Renders the landing page at `/` and the visualizer at `/play`. No DB, no secrets, no business logic — just UI + a little SSR. Consumes the server via the oRPC client (`/rpc`), the Better Auth React client (`/api/auth`), and the WebSocket (`/ws`), all same-origin through the gateway.
- `apps/server` — Bun + Hono + native WebSocket. **Single source of truth.** Owns Better Auth (`/api/auth/*`, incl. the Dodo webhook), the oRPC HTTP router (`/rpc` — credits, `mintWsTicket`), image upload (`/api/upload/image`), the live `Session`, fal generation, STT, song recognition, credit gating. Runs Drizzle migrations on boot.
- `packages/api` — generic oRPC primitives, the shared `sessionRouter`, the WS bridge.
- `packages/db` — Drizzle schema (`auth.db.ts`, `credits.db.ts`), migrations folder, `createDb` + `runMigrations` helpers. Imported by the **server** only (web no longer touches the DB).
- `packages/shared` — zod schemas, types, `typeid`, `ws-ticket` HMAC, pricing.
- `packages/test-utils` — pglite helper.

The HTTP oRPC router lives at `apps/server/src/rpc/app.router.ts`; the web client imports only its **type** via the `server/rpc` package export (`import type` is erased at build, so no server runtime deps leak into web).

## Production

Deployed on **Railway** behind **Cloudflare DNS** on the `sonara.fm` zone. Postgres template + two app services. Any `DATABASE_URL` in `apps/web/.env` / `apps/server/.env` is local-dev only — it points at a `bun run db:start` Postgres on `localhost:54324`, **not what production runs against**. Railway injects the prod DB URL at runtime via `${{Postgres.DATABASE_URL}}`; the server reads it from `env.DATABASE_URL` and applies `packages/db` migrations on every boot.

### Project

- **Name**: `sonara`
- **ID**: `33e35438-b78d-4cf9-8fe6-d0ba87e3c111`
- **Dashboard**: https://railway.com/project/33e35438-b78d-4cf9-8fe6-d0ba87e3c111

### Services

**Topology:**

| Service | Public URL | Internal address | Role |
|---|---|---|---|
| `gateway` | https://sonara.fm (+ www → 301) | — | Caddy. The only public service. Path-routes to server/web internally. |
| `web` | — (internal only) | `web.railway.internal:4472` | Next.js standalone; UI + SSR. |
| `server` | — (internal only)¹ | `server.railway.internal:4471` | Bun + Hono; Better Auth, `/rpc`, upload, WSS `/ws`, `/health`. |
| `Postgres` | `postgres.railway.internal:5432` (private) | — | auth + credits ledger |

¹ `api.sonara.fm` still resolves to `server` as a deprecation fallback; the codebase no longer references it. Safe to remove (CF `CNAME api` + `_railway-verify.api` TXT + the Railway custom domain) once you're certain no external integration still hits it.

Existing service IDs: web `235aa1d4-8c1b-4b7a-989a-099e61807e8c`, server `12262832-9534-4230-b032-c675d87f29b8`, gateway `c97ee875-5b9e-4467-94e8-eef5e8e93b81`, Postgres `a146f6cd-edab-48f5-ba44-c79b34caec32`. With the gateway in front, the browser only ever talks to `sonara.fm` (gateway) — auth, RPC, upload and WSS (`wss://sonara.fm/ws`) are all same-origin, so cookies are first-party and there's no CORS. The WS still auths with the short-lived HMAC ticket minted by `mintWsTicket` (a server `/rpc` procedure).

### Environments — `production` + `dev`

Two Railway environments in the **same** project, each a full stack (gateway/web/server/Postgres). Service IDs are shared across environments; everything else (Postgres data, S3 bucket, variables, the deploy branch) is per-environment.

| Environment | ID | Branch | Public URL | react-grab |
|---|---|---|---|---|
| `production` | `258d13bd-38b3-4310-9c39-672d01da9efa` | `main` | https://sonara.fm | off |
| `dev` | `cab8872e-9c58-411e-bbb6-056d6e963730` | `dev` | https://dev.sonara.fm | **on** |

**Workflow:** push feature work to `dev` → auto-deploys the `dev` env → once stable, **promote by merging `dev` → `main`** (auto-deploys prod). The deploy branch is set per-environment via `railway environment edit -e <env> --service-config <serviceId> source.branch <branch>`.

**Isolation:** the `dev` env was forked with `railway environment new dev --duplicate production`, which copied all variables/secrets but provisioned a **fresh empty Postgres** and a **separate S3 bucket** (`sonara-frames-hlwwxfsgres`) — the `${{Postgres.DATABASE_URL}}` / `${{sonara-frames.*}}` references re-point automatically. Migrations + the boot library-seed run on first server boot, so the fresh DB self-populates.

**Per-env variable deltas in `dev`** (everything else inherited from the fork): `APP_URL=https://dev.sonara.fm`, web build-args `NEXT_PUBLIC_WS_URL=wss://dev.sonara.fm/ws` + `NEXT_PUBLIC_ENABLE_DEVTOOLS=true`, `LOG_LEVEL=debug`, a fresh `BETTER_AUTH_SECRET`, and **Dodo disabled** (`DODO_PAYMENTS_API_KEY=""`, `DODO_PAYMENTS_MODE=test_mode`) so the public dev URL can't take live charges — add test-mode Dodo keys if you need to exercise the credits flow.

**react-grab** (the hover-to-grab element overlay) is gated in `apps/web/src/app/layout.tsx` on `NODE_ENV === "development" || NEXT_PUBLIC_ENABLE_DEVTOOLS === "true"`. `NEXT_PUBLIC_*` is inlined at build time, wired through `apps/web/Dockerfile` as a build arg — so flipping it requires a web **rebuild** (`railway redeploy --service web -e dev`), not just a restart.

### Cloudflare

- **Zone**: `sonara.fm` — id `3c4eff43a369f04340f8f83efb4870db`
- **Account**: `Kristjan.grm1@gmail.com's Account` — id `bceaeae4788dce3493514fde194b4a7e`
- **Records** (all proxied / orange-cloud):
  - `CNAME @` → `oatvmd0b.up.railway.app` (Railway web)
  - `CNAME www` → `sdb5b4d0.up.railway.app` (Railway web)
  - `CNAME api` → `bgpax7bc.up.railway.app` (Railway server)
  - `CNAME dev` → `abb5lekq.up.railway.app` (Railway **dev** gateway) — **DNS-only / grey-cloud**, see note below
  - `TXT _railway-verify`, `_railway-verify.www`, `_railway-verify.api` — Railway ownership tokens (required because Railway detects the CF proxy and falls back to TXT verification; do **not** delete)
  - 5x `MX` (email forwarding via Namecheap) + 1x `TXT` SPF — out-of-scope, leave alone
- **SSL/TLS mode**: Full (strict). Railway issues valid Let's Encrypt certs on custom domains.
- **Railway custom-domain TLS gotcha**: the prod records predate Railway's current flow — they're proxied + a legacy `_railway-verify` TXT (DNS-01) which Railway no longer issues. New custom domains (e.g. `dev.sonara.fm`) validate purely by **resolving the CNAME to the Railway target**, so they must be **DNS-only (grey-cloud)** for Railway to see the CNAME and issue the cert — a proxied record hides the target and gets stuck at `VALIDATING_OWNERSHIP` (prod `www` is stuck for exactly this reason). DNS-only means CF is out of the path for `dev.sonara.fm` (Railway-terminated TLS); app behaviour is identical. Cert state: `customDomain(id, projectId){ status { certificateStatus } }` via the backboard GraphQL API.
- **Always Use HTTPS**: on. **Automatic HTTPS Rewrites**: on.
- **www → apex**: **Page Rule** (not Bulk Redirect) — `www.sonara.fm/*` matches → forwarding URL `https://sonara.fm/$1` (301). Rule id `f5cc5fcde50ff7f29c21950d51259774`.

CF runs **DNS + TLS edge only** — no Workers, no rules-engine compute. All compute on Railway.

#### CF MCP — what it is and how to use it

`.mcp.json` registers the Cloudflare MCP (`https://mcp.cloudflare.com/mcp`) via `mcp-remote`, with a bearer API token (gitignored) passed as `--header "Authorization: Bearer ..."`. It exposes exactly **two tools**:

| Tool | Purpose |
|---|---|
| `mcp__cloudflare__search` | Search CF's OpenAPI spec for endpoints — call this **first** when you don't know the API path |
| `mcp__cloudflare__execute` | Execute a JS arrow function against CF's REST API via `cloudflare.request({ method, path, query, body })` |

This is "Code Mode" — there are no typed per-domain tools (no `list_dns_records`, etc.). Search the spec, then write the call.

Current token scope (any other op returns `9109 Unauthorized — request is not authorized`):

- Zone → DNS → Edit
- Zone → Zone → Read
- Zone → Zone Settings → Edit
- Zone → SSL and Certificates → Edit
- Zone → Page Rules → Edit
- Zone → Cache Rules → Edit (if added)
- **NOT** granted: Config Rules / Rulesets, Workers, R2, Tunnel, Account-level. Need a new permission? Edit the token at https://dash.cloudflare.com/profile/api-tokens → token `sonara.fm claude code integration` → Edit → add permission → Save. The token id is the same after edits; the MCP picks it up on the next session (no config change).

`curl` against `https://api.cloudflare.com/client/v4/...` with `Authorization: Bearer <token>` works for ad-hoc debugging when MCP isn't initialised yet.

### CLI (already installed + authenticated locally)

```bash
railway status                           # current project + service health
railway logs --service server -n 100     # pino structured logs (server or web)
railway variables --service server --kv  # env vars set on a service
railway domain api.sonara.fm --service server  # add a custom domain, prints CNAME target
railway redeploy --service server --yes  # redeploy latest deployment, no rebuild
railway run --service web -- <cmd>       # run a local command with Railway env vars injected
railway service Postgres && railway connect  # psql tunnel to the prod DB
```

Bash invocations of `railway status:*`, `railway logs:*`, `railway variables:*`, `railway whoami`, `railway list`, `railway link:*`, `railway service`, `railway domain:*`, `railway open:*` are pre-approved in `.claude/settings.local.json` — they don't need per-session permission. Destructive commands (`redeploy`, `down`, `delete`, `run -- …`) still gate on user approval.

`.mcp.json` (gitignored) registers `railway`, `cloudflare`, and `shadcn` MCP servers. Future agents pick up `mcp__railway__*` / `mcp__cloudflare__*` tools automatically; CLI is the fallback for Railway when MCP isn't initialized.

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
bun run db:start       # local Postgres (docker) — start this first
bun run dev            # gateway + web + server in parallel via turbo
bun run dev:web        # web only
bun run dev:server     # server only
bun run typecheck      # all packages
bun run lint           # oxlint
bun run test           # turbo test
bun run ci:local       # lint → typecheck → test → build (serial)
```

Open **`http://localhost:4470`** (the Caddy gateway) — that's the only origin the browser should use. The gateway proxies to web (`:4472`) and server (`:4471`) internally. WS is same-origin: `ws://localhost:4470/ws`. The gateway dev task runs `caddy:2-alpine` via `docker run --network host` (so it needs Docker; it's in `bun run dev`). Hitting `:4472` directly works for the UI but auth/RPC/WS won't (those live on the server behind the gateway).

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

- `packages/api/src/api.ts` — generic `publicProcedure` / `protectedProcedure` parameterised by `AnyContext`. Used for the shared `sessionRouter` (the WS surface).
- `apps/server/src/rpc/procedures.ts` — concrete `publicProcedure` / `protectedProcedure` narrowed to the server's `Database` type (`ServerHttpContext`). Used for `auth.router.ts`, `credits.router.ts` (the HTTP `/rpc` surface).

The duplication exists so the HTTP routers can supply a concrete context shape without leaking concrete types across the `packages/api` boundary. Mirrors the pattern in `~/code/invok/apps/admin-api/src/procedures.ts`.

## State ownership

- **Server-authoritative** — the live scene, voice intent atmosphere, credit state, version counters. Lives in `apps/server/src/session/session.ts` (`Session` class) and is broadcast via the `eventIterator` subscription.
- **Client UI state** — preset selection, panel visibility, voice trail UI, inspector HUD. Lives in `apps/web/src/stores/visualizer-store.ts` (zustand).

Voice intent is duplicated by design: the `VoiceController` on the server owns dispatch + debouncing; the client store owns the trail UI. Don't try to unify them.

## Auth

Better Auth instance in `apps/server/src/auth/auth.ts`, mounted on the server's Hono app at `/api/auth/*`. One session cookie, read by the `/rpc` context builder + `protectedProcedure` middleware. `trustedOrigins = [baseURL]`, where `baseURL` is `env.APP_URL` (the public gateway origin) — bumping the env var transparently updates origins on the next deploy. Because the browser reaches `/api/auth` same-origin through the gateway, the cookie is first-party on the public domain and there's no CORS. The web side uses the `better-auth/react` client (`apps/web/src/lib/auth-client.ts`) with `baseURL = window.location.origin`.

- **Email + password** (open signup): Better Auth's built-in `emailAndPassword`. Anyone can register; live fal generation is gated by the credits ledger + free-tier. Unauthenticated visitors connect with an anon WS ticket (`userId: null`) and run the visualiser in demo-library mode — no fal calls, no credit debit, no AudD song recognition. UI lives at `/login`. The earlier `allowed_email` allowlist + `allow-email` script were removed when the public demo path landed; the table is kept as inert data pending a follow-up drop migration.
- **Dodo Payments plugin** (optional, currently inactive in prod with placeholder envs): registers when both `DODO_PAYMENTS_API_KEY` and `DODO_PAYMENTS_WEBHOOK_SECRET` are set.

For the WebSocket: the browser mints a 5-min HMAC ticket via `auth.mintWsTicket` — now a server `/rpc` `publicProcedure` (`apps/server/src/rpc/auth.router.ts`), reached same-origin through the gateway — then opens `wss://sonara.fm/ws?token=…` (also gateway → server). The server verifies the ticket via `verifyTicket` from `@sonara/shared`. Signed-in callers get a ticket carrying the user uuid; unauthenticated callers get an anon ticket (`userId: null`) and the server pins that session to demo-library mode (no fal, no credits, no AudD). The ticket scheme stays even though everything is same-origin now: it cleanly carries identity to the WS upgrade without parsing cookies at the socket layer.

SIWE / Reown / wallet-based auth and USDC-on-Base top-ups were removed in `b906ac4`. No `viem`, `wagmi`, or `@reown/*` packages remain in the workspace. If a stale doc still references them, it's a doc bug.

## Credits & money path

- `apps/server/src/credits/credits.service.ts` — atomic `debitFrame` / `tryConsumeFreeTier` / `refundFrame` / `getBalance`. Direct `pg` queries at the trigger site.
- `apps/server/src/rpc/credits.router.ts` — `getBalance` (frame balance + month-to-date usage + lifetime spend) + `createCheckout` (Dodo Payments hosted checkout for the credit packs in `packages/shared/src/pricing.ts`). Drizzle queries. The success page `apps/web/src/app/credits/success/page.tsx` polls `getBalance` (via the gateway → server `/rpc`) for the webhook to land.
- `apps/server/src/auth/dodo-webhook.ts` — `onPaymentSucceeded` credits frames; served by Better Auth at `/api/auth/dodopayments/webhook`. Idempotent on `payment_id` via the `usage_ledger.tx_hash` partial unique index.
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
