# Agent guide

Conventions for working in this repo. Read this before making non-trivial changes. Living document — append decisions here when they're worth surviving the next session.

## Quick orient

- `apps/web` — Next.js 16, oRPC, Better Auth (email+password). Renders the landing page at `/` and the visualizer at `/play`. Also serves the Dodo Payments webhook.
- `apps/server` — Bun + Hono + native WebSocket. Owns the live `Session`, fal generation, STT, song recognition, credit gating. Runs Drizzle migrations on boot.
- `packages/api` — generic oRPC primitives, the shared `sessionRouter`, the WS bridge.
- `packages/db` — Drizzle schema (`auth.db.ts`, `credits.db.ts`), migrations folder, `createDb` + `runMigrations` helpers. Owned by both apps.
- `packages/shared` — zod schemas, types, `typeid`, `ws-ticket` HMAC, pricing.
- `packages/test-utils` — pglite helper.

## Production

Deployed on **Railway** behind **Cloudflare DNS** on the `sonara.fm` zone. Postgres template + two app services. Any `DATABASE_URL` in `apps/web/.env` / `apps/server/.env` is local-dev only — it points at a `bun run db:start` Postgres on `localhost:54324`, **not what production runs against**. Railway injects the prod DB URL at runtime via `${{Postgres.DATABASE_URL}}`; the server reads it from `env.DATABASE_URL` and applies `packages/db` migrations on every boot.

### Project

- **Name**: `sonara`
- **ID**: `33e35438-b78d-4cf9-8fe6-d0ba87e3c111`
- **Dashboard**: https://railway.com/project/33e35438-b78d-4cf9-8fe6-d0ba87e3c111

### Services

| Service | Public URL | Railway CNAME target | Service ID | Role |
|---|---|---|---|---|
| `web` | https://sonara.fm (+ www → 301 → apex) | `oatvmd0b.up.railway.app` (apex), `sdb5b4d0.up.railway.app` (www) | `235aa1d4-8c1b-4b7a-989a-099e61807e8c` | Next.js standalone; SSR + `/api/auth/*` (Better Auth) + future `/api/dodo/*` |
| `server` | https://api.sonara.fm | `bgpax7bc.up.railway.app` | `12262832-9534-4230-b032-c675d87f29b8` | Bun + Hono; HTTP `/health`, WSS `/ws` |
| `Postgres` | `postgres.railway.internal:5432` (private) | n/a | n/a (Railway template) | auth + credits ledger |

The Bun server exposes **no browser-facing HTTP API** beyond `/health`. All HTTP that the browser hits (Better Auth, Dodo webhook) is served by Next.js on the web service. Only the WebSocket crosses the origin boundary, and it auths with an HMAC ticket (not the auth cookie), so cross-origin to `api.sonara.fm` is fine.

Railway's auto-generated `*.up.railway.app` domains remain live as a fallback during the cutover window. Remove after a week of stable traffic on the new URLs.

### Cloudflare

- **Zone**: `sonara.fm` — id `3c4eff43a369f04340f8f83efb4870db`
- **Account**: `Kristjan.grm1@gmail.com's Account` — id `bceaeae4788dce3493514fde194b4a7e`
- **Records** (all proxied / orange-cloud):
  - `CNAME @` → `oatvmd0b.up.railway.app` (Railway web)
  - `CNAME www` → `sdb5b4d0.up.railway.app` (Railway web)
  - `CNAME api` → `bgpax7bc.up.railway.app` (Railway server)
  - `TXT _railway-verify`, `_railway-verify.www`, `_railway-verify.api` — Railway ownership tokens (required because Railway detects the CF proxy and falls back to TXT verification; do **not** delete)
  - 5x `MX` (email forwarding via Namecheap) + 1x `TXT` SPF — out-of-scope, leave alone
- **SSL/TLS mode**: Full (strict). Railway issues valid Let's Encrypt certs on custom domains.
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

Better Auth instance in `apps/web/src/server/auth.ts`. One session cookie, read by `protectedProcedure` middleware. `trustedOrigins = [baseURL]`, where `baseURL` is derived from `env.APP_URL` — bumping the env var transparently updates origins on the next deploy.

- **Email + password** (open signup): Better Auth's built-in `emailAndPassword`. Anyone can register; live fal generation is gated by the credits ledger + free-tier. Unauthenticated visitors connect with an anon WS ticket (`userId: null`) and run the visualiser in demo-library mode — no fal calls, no credit debit, no AudD song recognition. UI lives at `/login`. The earlier `allowed_email` allowlist + `allow-email` script were removed when the public demo path landed; the table is kept as inert data pending a follow-up drop migration.
- **Dodo Payments plugin** (optional, currently inactive in prod with placeholder envs): registers when both `DODO_PAYMENTS_API_KEY` and `DODO_PAYMENTS_WEBHOOK_SECRET` are set.

For the WebSocket: the web app mints a 5-min HMAC ticket via `auth.mintWsTicket` (now a `publicProcedure`); the browser opens `wss://api.sonara.fm/ws?token=…`; the server verifies the ticket via `verifyTicket` from `@sonara/shared`. Signed-in callers get a ticket carrying the user uuid; unauthenticated callers get an anon ticket (`userId: null`) and the server pins that session to demo-library mode (no fal, no credits, no AudD). The ticket path is auth-method-agnostic, which is why WS lives on a cross-origin subdomain without needing CORS or shared cookies.

SIWE / Reown / wallet-based auth and USDC-on-Base top-ups were removed in `b906ac4`. No `viem`, `wagmi`, or `@reown/*` packages remain in the workspace. If a stale doc still references them, it's a doc bug.

## Credits & money path

- `apps/server/src/credits/credits.service.ts` — atomic `debitFrame` / `tryConsumeFreeTier` / `refundFrame` / `getBalance`. Direct `pg` queries; no Drizzle dependency in apps/server.
- `apps/web/src/server/rpc/credits.router.ts` — `getBalance` (frame balance + month-to-date usage + lifetime spend) + `createCheckout` (Dodo Payments hosted checkout for the credit packs in `packages/shared/src/pricing.ts`; the success page `apps/web/src/app/credits/success/page.tsx` polls `getBalance` for the webhook to land).
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
