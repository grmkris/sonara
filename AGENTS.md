# Agent guide

Conventions for working in this repo. Read this before making non-trivial changes. Living document — append decisions here when they're worth surviving the next session.

## Quick orient

- `apps/gateway` — Caddy reverse proxy (`caddy:2-alpine`). The single public entry. Path-routes `/api/auth/*`, `/rpc/*`, `/api/upload/*`, `/ws` to the server and everything else to web, over `*.railway.internal`. So the browser sees one origin → cookies first-party, no CORS.
- `apps/web` — Next.js 16, thin frontend. Renders the landing page at `/`, the visualizer at `/play`, the set library at `/studio`, and the set permalink at `/s/[id]`. No DB, no secrets, no business logic — just UI + a little SSR. Consumes the server via the oRPC client (`/rpc`), the Better Auth React client (`/api/auth`), and the WebSocket (`/ws`), all same-origin through the gateway.
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
| `server` | — (internal only) | `server.railway.internal:4471` | Bun + Hono; Better Auth, `/rpc`, upload, WSS `/ws`, `/health`. |
| `Postgres` | `postgres.railway.internal:5432` (private) | — | auth + credits ledger |

Existing service IDs: web `235aa1d4-8c1b-4b7a-989a-099e61807e8c`, server `12262832-9534-4230-b032-c675d87f29b8`, gateway `c97ee875-5b9e-4467-94e8-eef5e8e93b81`, Postgres `a146f6cd-edab-48f5-ba44-c79b34caec32`. With the gateway in front, the browser only ever talks to `sonara.fm` (gateway) — auth, RPC, upload and WSS (`wss://sonara.fm/ws`) are all same-origin, so cookies are first-party and there's no CORS. The WS still auths with the short-lived HMAC ticket minted by `mintWsTicket` (a server `/rpc` procedure).

### Environments — `production` + `dev`

Two Railway environments in the **same** project, each a full stack (gateway/web/server/Postgres). Service IDs are shared across environments; everything else (Postgres data, S3 bucket, variables, the deploy branch) is per-environment.

| Environment | ID | Branch | Public URL | react-grab |
|---|---|---|---|---|
| `production` | `258d13bd-38b3-4310-9c39-672d01da9efa` | `main` | https://sonara.fm | off |
| `dev` | `cab8872e-9c58-411e-bbb6-056d6e963730` | `dev` | https://dev.sonara.fm | **on** |

**Workflow:** the machine-wide **dev-flow** (canonical rules in `~/.claude/CLAUDE.md`). Commit directly to `dev` → push auto-deploys the `dev` env (test on dev.sonara.fm, not locally) → **promote to prod only when asked, via a PR `dev` → `main`** the user reviews + merges (merging auto-deploys prod). The deploy branch is set per-environment via `railway environment edit -e <env> --service-config <serviceId> source.branch <branch>`.

> **Merge with a merge commit — never squash.** `dev` and `main` are long-lived branches, so a squash merge re-writes every promoted commit into one new SHA on `main`; `dev`'s originals stay non-ancestors, so each later `dev → main` PR shows those already-shipped commits as "phantom" un-merged work (this bit PR #1 — Noir et al. were already on `main` via the squash, yet reappeared in PR #2's commit list). A real merge commit makes `dev`'s commits ancestors of `main`, so future PRs show only genuinely-new work. The repo's merge settings enforce this: **merge commit allowed, squash + rebase disabled** (`gh api repos/grmkris/sonara`). Trust the PR's **Files-changed** diff, not the commit list, when histories have already diverged from a past squash.

**Isolation:** the `dev` env was forked with `railway environment new dev --duplicate production`, which copied all variables/secrets but provisioned a **fresh empty Postgres** and a **separate S3 bucket** (`sonara-frames-hlwwxfsgres`) — the `${{Postgres.DATABASE_URL}}` / `${{sonara-frames.*}}` references re-point automatically. Migrations + the boot library-seed run on first server boot, so the fresh DB self-populates.

**Environment identity:** a single `APP_ENV` (`local | dev | prod`) on the server and `NEXT_PUBLIC_APP_ENV` (web build arg) is the only var that differs between environments. Every per-environment URL (public origin, WS origin, SSR-internal RPC), the logger mode (pretty when `!== "prod"`, JSON on prod), the Dodo test/live mode, and the react-grab overlay are all **derived** from it via `SERVICE_URLS` / `dodoModeForEnv` in `packages/shared/src/services.ts`. It's required with no default — a deploy that forgets it fails to boot. (`NODE_ENV` stays `production` in both Docker images for library behaviour only.)

**Per-env variable deltas in `dev`** (everything else inherited from the fork): `APP_ENV=dev` (server) + `NEXT_PUBLIC_APP_ENV=dev` (web build arg), `LOG_LEVEL=debug`, a fresh `BETTER_AUTH_SECRET`, and **Dodo disabled** (`DODO_PAYMENTS_API_KEY=""`) so the public dev URL can't take live charges — add test-mode Dodo keys if you need to exercise the credits flow. (The dev URLs `https://dev.sonara.fm` + `wss://dev.sonara.fm/ws` come from `SERVICE_URLS.dev`, not per-URL vars.)

**react-grab** (the hover-to-grab element overlay) is gated in `apps/web/src/app/layout.tsx` on `NEXT_PUBLIC_APP_ENV !== "prod"` (so local + dev get it). `NEXT_PUBLIC_*` is inlined at build time, wired through `apps/web/Dockerfile` as a build arg — so it follows the build's `APP_ENV`; changing it requires a web **rebuild**, not just a restart.

### Cloudflare

- **Zone**: `sonara.fm` — id `3c4eff43a369f04340f8f83efb4870db`
- **Account**: `Kristjan.grm1@gmail.com's Account` — id `bceaeae4788dce3493514fde194b4a7e`
- **Records** (all proxied / orange-cloud) — verified live against the CF API:
  - `CNAME @` → `qvfbf1lq.up.railway.app` (Railway **gateway**)
  - `CNAME www` → `i7u5rpxc.up.railway.app` (→ 301 to apex via a CF page rule)
  - `CNAME dev` → `abb5lekq.up.railway.app` (Railway **dev** gateway)
  - `TXT _railway-verify`, `_railway-verify.www`, `_railway-verify.dev` — Railway ownership tokens (required because Railway detects the CF proxy and validates via TXT/DNS-01; do **not** delete)
  - 5x `MX` (email forwarding via Namecheap) + 1x `TXT` SPF — out-of-scope, leave alone
  - (`api.sonara.fm` was decommissioned — no CNAME/verify TXT; all traffic enters via the gateway. Don't re-add.)
- **SSL/TLS mode**: **Full — NOT Full (Strict).** Railway requires Full for proxied domains; **Full (Strict) throws Error 526 during Railway's cert-renewal windows** (the CF→origin leg uses Railway's `*.up.railway.app` cert, which Strict over-validates). This bit sonara (intermittent dev outages) until flipped to Full on 2026-06-04. stylelab + invok are also Full. Railway's per-host check shows ⚠️ on the proxied CNAMEs — harmless (cosmetic; certs are TXT-verified + issued).
- **Railway custom-domain TLS procedure (proxied + verify TXT)**: to add a custom domain that stays proxied through CF (the prod pattern), add **both** records: the proxied `CNAME` to the Railway target **and** a `TXT _railway-verify.<sub>` = `railway-verify=<token>`. Railway validates ownership via the TXT (DNS-01), so it never needs to see the proxied CNAME. ⚠️ **The `railway-verify` token is shown only in the Railway dashboard** (Service → Settings → Networking → the custom domain) — the backboard GraphQL `customDomain.status.dnsRecords` returns *only* the traffic-route CNAME, never the TXT, so you must read the token from the dashboard. Without the TXT a proxied domain hangs at `VALIDATING_OWNERSHIP` forever (`www` had this until its `_railway-verify.www` TXT was added — it now resolves + 301s fine). Don't bother with the DNS-only workaround; just add the TXT. Lifecycle: `VALIDATING_OWNERSHIP → ISSUING → VALID` (a few min each); poll `customDomain(id, projectId){ status { certificateStatus } }`. Beware Let's Encrypt's ~5-failed-validations/hour/hostname limit — repeated wrong attempts (e.g. proxied with no TXT) throttle issuance for the rest of the hour.
- **Always Use HTTPS**: on. **Automatic HTTPS Rewrites**: on.
- **www → apex**: **Page Rule** (not Bulk Redirect) — `www.sonara.fm/*` matches → forwarding URL `https://sonara.fm/$1` (301). Rule id `f5cc5fcde50ff7f29c21950d51259774`.

CF runs **DNS + TLS edge only** — no Workers, no rules-engine compute. All compute on Railway.

#### CF MCP — what it is and how to use it

The Cloudflare MCP (`https://mcp.cloudflare.com/mcp`) is registered **globally** in `~/.claude` (not a repo `.mcp.json` — sonara has none), with a bearer API token passed as an `Authorization: Bearer …` header. It exposes exactly **two tools**:

| Tool | Purpose |
|---|---|
| `mcp__cloudflare__search` | Search CF's OpenAPI spec for endpoints — call this **first** when you don't know the API path |
| `mcp__cloudflare__execute` | Execute a JS arrow function against CF's REST API via `cloudflare.request({ method, path, query, body })` |

This is "Code Mode" — there are no typed per-domain tools (no `list_dns_records`, etc.). Search the spec, then write the call.

Current token — **`claude-code (kristjan-dev)`**, scope *1 Account · All zones* (any ungranted op returns `9109 Unauthorized — request is not authorized`):

- Zone → DNS → Edit · Zone → Zone → Edit · Zone Settings → Edit · SSL and Certificates → Edit · Page Rules → Edit · Cache Rules → Edit · Workers Routes → Edit
- **Zone → Analytics → Read** · **Account → Account Analytics → Read** — added 2026-06-04 for visitor stats (see §Analytics below). Account Analytics is **read-only**; there is no Edit variant.
- Account → Cloudflare Pages → Edit · Workers Scripts → Edit · Account Settings → Edit
- **NOT** granted: R2, Tunnel, Config Rules / Rulesets. Need a new permission? Edit the token at https://dash.cloudflare.com/profile/api-tokens → token `claude-code (kristjan-dev)` → Edit → add permission → Save. The token **string is unchanged** after edits, so the expanded scope takes effect **immediately** server-side — no new session needed (the MCP keeps sending the same bearer).

`curl` against `https://api.cloudflare.com/client/v4/...` with `Authorization: Bearer <token>` works for ad-hoc debugging when MCP isn't initialised yet.

#### Analytics / visitor stats

- **Traffic / visitor counts** — the legacy REST Zone Analytics API (`/zones/{id}/analytics/dashboard`) is **sunset** (`1015 Zone Analytics API is sunset`). Use the **GraphQL Analytics API**: `cloudflare.request({ method: "POST", path: "/graphql", body: { query } })`. Dataset `httpRequests1dGroups` (daily) or `httpRequests1hGroups` (hourly), filter on `zoneTag` + `date_geq/date_leq`; useful fields `uniq { uniques }`, `sum { requests pageViews countryMap { clientCountryName requests } }`. Edge-measured + **retroactive**, no beacon needed (zone is orange-clouded). ⚠️ Raw `requests` is polluted by bots/scanners (single-country spikes of 1k+); **`uniques` + `pageViews` are the real-human signal**.
- **Web Analytics (RUM beacon)** — enabled on the zone (site_tag `28bb308f1ed44069badd991698616b13`). CF's edge auto-injection does **not** fire on Next's streamed App-Router SSR, so the beacon is embedded manually in `apps/web/src/app/layout.tsx`, **prod-gated** on `NEXT_PUBLIC_APP_ENV === "prod"` (keeps dev.sonara.fm out of the dashboard). Cookieless, no consent banner. Gives per-page pageviews/referrers/web-vitals going forward; not retroactive — historical/visitor totals come from the GraphQL traffic API above. Dashboard: Analytics & Logs → Web Analytics.

### CLI (already installed + authenticated locally)

```bash
railway status                           # current project + service health
railway logs --service server -n 100     # evlog structured logs (server or web)
railway variables --service server --kv  # env vars set on a service
railway domain example.sonara.fm --service gateway  # add a custom domain, prints CNAME target
railway redeploy --service server --yes  # redeploy latest deployment, no rebuild
railway run --service web -- <cmd>       # run a local command with Railway env vars injected
railway service Postgres && railway connect  # psql tunnel to the prod DB
```

Bash invocations of `railway status:*`, `railway logs:*`, `railway variables:*`, `railway whoami`, `railway list`, `railway link:*`, `railway service`, `railway domain:*`, `railway open:*` are pre-approved in `.claude/settings.local.json` — they don't need per-session permission. Destructive commands (`redeploy`, `down`, `delete`, `run -- …`) still gate on user approval.

The `railway` and `cloudflare` MCP servers are registered **globally** in `~/.claude` (sonara has no repo `.mcp.json`). Future agents pick up `mcp__railway__*` / `mcp__cloudflare__*` tools automatically; CLI is the fallback for Railway when MCP isn't initialized.

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
bun run typecheck      # all packages (tsc — authoritative)
bun run lint           # oxlint
bun run test           # turbo test
bun run ci:step        # lint + typecheck:fast (tsgo) — the per-step check, ~25s
bun run ci:local       # lint → typecheck → test → build — the push gate, ~3min
```

### Verification loop (agents: follow this — don't run ci:local per step)

Three tiers, cheapest first. The expensive pipeline runs exactly twice a
session, not once per edit:

1. **Per edit** — `bunx oxlint <changed files>` (sub-second). Catches the
   strict ultracite nits (sort-keys, prefer-destructuring, a11y…) the moment
   they're written instead of via a 3-minute pipeline round-trip.
2. **Per step / work package** — `bun run ci:step` (~25s for a one-package
   change, cached otherwise): whole-repo lint + **tsgo** typecheck (the
   official TS-in-Go preview checker; ~5× faster than tsc, near-parity).
   Add `bun test <dir>` in the touched package when logic changed (the
   server PGlite suite is ~14s).
3. **Per push gate** — `bun run ci:local` (authoritative tsc + tests + real
   builds, concurrency 4). Always green before pushing `dev` — a push
   deploys.

tsgo is the speed layer, tsc stays the authority at gates — if the preview
checker ever diverges, the gate catches it before anything ships. Note
`bun run check` (ultracite `--type-aware`) is NOT a CI signal: its extra
type-aware ruleset was never adopted (~1000 open findings repo-wide).

Open **`http://localhost:4470`** (the Caddy gateway) — that's the only origin the browser should use. The gateway proxies to web (`:4472`) and server (`:4471`) internally. WS is same-origin: `ws://localhost:4470/ws`. The gateway dev task runs `caddy:2-alpine` via `docker run --network host` (so it needs Docker; it's in `bun run dev`). Hitting `:4472` directly works for the UI but auth/RPC/WS won't (those live on the server behind the gateway).

## Lint & format

oxlint + oxfmt, configured via the **ultracite** preset — the strict, AI-oriented ruleset (~530 rules / 12 plugins incl. `jsx-a11y`), **not** oxlint's light defaults (correctness-only). The sibling repos on this stack (stylelab) share it.

- `oxlint.config.ts` → `extends [ultracite/oxlint/core, react, next]`; `oxfmt.config.ts` → re-exports `ultracite/oxfmt`. `oxlint-tsgolint` (devDep) backs the `--type-aware` flag — without it `bun run check`/`fix` error out.
- `bun run lint` → `oxlint` (this is what `ci:local`/CI runs). `bun run check` / `fix` / `fix:unsafe` → `ultracite … --type-aware --type-check` (lint + oxfmt in one). **Never run `--unsafe` unattended** — it strips `async` off no-`await` fns (breaks their `Promise` return type) and mangles exhaustive discriminated-union switches.
- We use ultracite's **lint layer only**. Do **not** run `ultracite init` — it regenerates these configs and injects a generic rules dump into this file + `CLAUDE.md`. The linter is the source of truth; its generic standards aren't vendored here.

**Deliberate carve-outs — don't "fix" these.** ~54 `// oxlint-disable … -- REVIEW: …` comments mark rules that don't fit this codebase (`grep -rn "oxlint-disable.*REVIEW:" apps packages`; full index + dispositions in `docs/lint-disables-review.md`). Leave these alone:

- **fire-and-forget promises** (`prefer-await-to-then`/`-callbacks`) — session `stream*`, credit refund, WS bootstrap, 60 Hz audio tick; awaiting blocks the live hot path.
- **intentional barrels** (`no-barrel-file`) — package `index.ts` entrypoints.
- **bitwise** (`no-bitwise`) — constant-time crypto compare (`ws-ticket.ts`) + seed masks.
- **`sort-keys`** — env / Drizzle schema / preset orderings are curated, not alphabetical.
- **`complexity`** — DSP / canvas / dispatch loops kept whole (see Don't touch).
- native `confirm`/`prompt` (`no-alert`), `.onX=` handler assignment (`prefer-add-event-listener`), byte-level `charCodeAt` (`prefer-code-point`), ServiceWorker `postMessage` (no `targetOrigin` param).

Only **3** are genuinely rewritable (flagged 🟢 in the doc): `catch-error-name`, `default-case`, `no-use-before-define`.

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

Better Auth instance in `apps/server/src/auth/auth.ts`, mounted on the server's Hono app at `/api/auth/*`. One session cookie, read by the `/rpc` context builder + `protectedProcedure` middleware. `trustedOrigins = [baseURL]`, where `baseURL` is `SERVICE_URLS[env.APP_ENV].web` (the public gateway origin) — set `APP_ENV` and origins follow on the next deploy. Because the browser reaches `/api/auth` same-origin through the gateway, the cookie is first-party on the public domain and there's no CORS. The web side uses the `better-auth/react` client (`apps/web/src/lib/auth-client.ts`) with `baseURL = window.location.origin`.

- **Email + password** (open signup): Better Auth's built-in `emailAndPassword`. Anyone can register; live fal generation is gated by the credits ledger + free-tier. Unauthenticated visitors connect with an anon WS ticket (`userId: null`) and run the visualiser in demo-library mode — no fal calls, no credit debit, no AudD song recognition. UI lives at `/login`. The earlier `allowed_email` allowlist + `allow-email` script were removed when the public demo path landed; the table is kept as inert data pending a follow-up drop migration.
- **Dodo Payments plugin** (optional, currently inactive in prod with placeholder envs): registers when both `DODO_PAYMENTS_API_KEY` and `DODO_PAYMENTS_WEBHOOK_SECRET` are set.

For the WebSocket: the browser mints a 5-min HMAC ticket via `auth.mintWsTicket` — now a server `/rpc` `publicProcedure` (`apps/server/src/rpc/auth.router.ts`), reached same-origin through the gateway — then opens `wss://sonara.fm/ws?token=…` (also gateway → server). The server verifies the ticket via `verifyTicket` from `@sonara/shared`. Signed-in callers get a ticket carrying the user uuid; unauthenticated callers get an anon ticket (`userId: null`) and the server pins that session to demo-library mode (no fal, no credits, no AudD). The ticket scheme stays even though everything is same-origin now: it cleanly carries identity to the WS upgrade without parsing cookies at the socket layer.

SIWE / Reown / wallet-based auth and USDC-on-Base top-ups were removed in `b906ac4`. The Monad/USDC crowd-stage payment layer (smart accounts, Pimlico, the SonaraStage contract, `packages/onchain`/`packages/contracts`, the `/api/mcp` agent) was removed in the de-chaining pass: crowd taps/prompts now travel over public `stage.tap` / `stage.setKnob` / `stage.submitPrompt` RPCs (room code = capability, token-bucket throttled per `stage-throttle.ts`), and generation a crowd prompt triggers is charged to the STAGE OWNER's credits — bounded by the dwell queue (`PROMPT_DWELL_MS`) + the 200ms knob flush in `apps/server/src/stage/stage-actions.ts`. Crowd identity is a per-device 4-char handle (`lib/stage/handle.ts`), never an account. No `viem`, `wagmi`, or `@reown/*` packages remain in the workspace. If a stale doc still references them, it's a doc bug.

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
- **Playback path**: deck playback is CLIENT-driven — the browser's playback loop walks the deck manifest and reports frames/source over WS (`frame.report` / `source.report`); the server's `source` state machine (`Session.setSource`, the `demoMode` successor) gates `trigger()` so a client-driven source never generates. Store: `apps/web/src/stores/visualizer/source-slice.ts` (localStorage `viz_source`).
- **Assets**: WebPs live under `apps/web/public/library/<deck>/<typeid>.webp` and ship with the Next build. Database `url` column stores the relative path — same on dev and prod.
- **Seeding fresh prompts** (calls fal): `cd apps/server && bun run seed:library` (optionally `--deck <key> --limit <n> --model <id> --dry-run`). Re-runs are idempotent via `sha256(deck::prompt)` in `prompt_hash`.
- **Seeding from the committed export** (no fal, replay-safe): `bun run export:library` after a fal seed dumps `apps/server/scripts/library-seed.json` (commit it). `bun run seed:library -- --from-export` replays it. Production fill-up: `railway run --service server -- bun run scripts/seed-library.ts -- --from-export`.

## Sets (`frame_set`)

One entity for everything playable (see `docs/sets-architecture.md`). What used to be three concepts — built-in *decks*, archived *sessions*, curated *reels* — is a **Set**, distinguished only by `origin: 'builtin' | 'recording' | 'curated'`. UI word is "set"; code/schema say `frameSet` / `frame_set`, typeid prefix `set_` (never a bare `set` — collides with JS `Set` / SQL `SET`; ungreppable).

- **Schema**: `packages/db/src/schema/frame-set.db.ts`. Sets *reference* `image_library` rows via `frame_set_frame` (Photos→Albums — never copied). `t_ms` on junction rows drives cadence: present → original timing, null → fixed loop.
- **Router**: `apps/server/src/rpc/sets.router.ts` — successor of the reel router. Mutation policy: builtin immutable; **recording frame lists are frozen** (it's the take — metadata stays editable; "make a cut" seeds a curated set instead); curated fully owner-editable. `sets.get` is **public** (visibility-gated; private-to-others = `NOT_FOUND` so existence doesn't leak).
- **Recordings are auto-captured**: going live as a signed-in producer creates a `origin: recording` set and appends frames with real `t_ms` as the show happens; `status` flips `recording → final` at the end. No "save" step. (Anon/demo sessions generate nothing new — nothing to record.)
- **Permalink**: `/s/<set_id>` — live view while the show runs (via the `lens` procedure in `control.router.ts`), replay forever after; the link never dies. `/s/<id>/control` is the owner's console facet over the `control.*` HTTP router.
- Built-in decks exist twice on purpose: the deck registry (`packages/shared/src/decks.ts`) still drives the client-native demo loop, **and** each deck is seeded as a `origin: builtin` set row (`frame_set_deck_key_idx`) so it shows in the unified picker. The boot seed converges both.

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
- For UI changes, push to `dev` and verify on dev.sonara.fm — don't run the app locally (dev-flow; see `~/.claude/CLAUDE.md`). Static checks (typecheck/build/lint) before pushing are fine.
- Don't write new docs unless asked. Update this file when a convention solidifies.

## Performance instrument

- `/play` opens the listening surface: Sound / Look / Camera / Record. Users supply tab audio, microphone input, or a local file; there is no bundled soundtrack. `FlowConfig` version 5 drives Ink / Silk / Prism / Kaleido / Loom / Orbit / Relief with one Response control. Play’s Look panel has Looks and Image tabs: one-image generation, photo upload, and image presence are available there. Keep the Image tab mounted while hidden so pending generation and photo URLs survive tab switches. Studio Create (`/studio/live`) owns continuous generation, MIDI, and detailed controls through the same `StageScreen` workspace implementation. Saved v1/v2/v3/v4 takes retain their original renderer; live preferences migrate separately to `sonara_experience_v5`, preserving the old preference key. `apps/web/src/lib/instrument` owns instance-scoped Three/TSL rendering, fixed-step transport, MediaPipe input, MIDI, capture, replay, and streamed export. Local rendering does not generate images: the server receives a `procedural` source unless continuous image evolution is explicitly enabled in Studio Create. Play reports a procedural source even if a stale snapshot says live. One-image requests use `mood.generate` with a persistent client request UUID and the existing durable `generation_job` worker; retries reuse the same job. Photos and procedural motion need no generation or account.
- V4 adds fixed-step pinch contacts in `surface-controls.ts` and deformation/depth materials in `touch-nodes.ts`. Pinch anchors use fingertip coordinates; relative push/pull uses palm scale calibrated per pinch, with orientation rejection, never wrist-relative MediaPipe Z. Store resolved contacts in motion events so replay does not re-run tracking. Relief lazily downloads a pinned Depth Anything V2 Small model via Transformers.js, estimates once per image in a worker, and caches at most 12 depth maps by image hash on the device. Packed RG depth is a lossless PNG in the existing `images` chunks, referenced by `depth` events; never JPEG-compress or apply sRGB to depth. Photo URLs belong to the surface, not its popup.
- V5 keeps the shader surface and adds `flow-layer.ts`: interrupted image transitions snapshot the current composite, fit each image independently, and evolve for 3.2 simulation seconds. Silhouette echoes use bounded, fixed-step mask feedback with a finite decay cutoff; presentation must never advance either history. Body mode detects up to three people and unions their processed masks; anatomical arm controls are averaged into two shared controls rather than assigning unstable person IDs. The worker closes every MediaPipe result after copying masks.
- New v3 treatments use separate material graphs in `experience-effects.ts`; preserve the existing Ink/Silk/Prism graph so saved performances keep their appearance. Extend the shared schema and deploy server support before exposing a new treatment in the web UI.
- The `MusicalDirector` consumes every analyzed audio window. V2/v3/v4/v5 captures store resolved `motion` events with simulation time; replay never re-runs musical inference. Simulation catches up at most three steps per display frame and presentation runs once. Fluid feedback lives in the fixed-resolution dye simulation, not a display-rate history buffer.
- Audio windows originate in `/audio/capture-worklet.<hash>.js`; musical analysis runs in `analysis.worker.ts`. Keep FFT work and tracking inference off the render/UI thread. MediaPipe models and WASM are self-hosted in `public/vision`, loaded only after camera opt-in. Captures store processed silhouettes and control values, never webcam video.
- Performance takes extend `frame_set` through `performance_take` and resumable `performance_take_chunk` rows. Original takes are immutable after finalization; edits create a curated remix. Browser IndexedDB keeps recoverable chunks before upload. `/studio/takes/[id]` accepts a local UUID or account `set_` ID; `/set/[id]` also opens performance takes. The shared take manifest versions renderer settings and retains trim points.

Public worklets and world previews use content hashes in their filenames. Rename them and update their references when their bytes change: the gateway/CDN caches public assets, and a stale worklet can speak an incompatible message protocol to a new client.

Worker entrypoints must bypass the service-worker response cache: Turbopack uses one bootstrap filename with different `#params` module lists. Cache matching drops fragments, and a cached response URL can start an unrelated/old worker. Imported build chunks remain cacheable.

Instrument panels use Base UI Popover on desktop and bottom Sheet on mobile. Audio elements and captured streams belong to the audio-source lifecycle, not panel components. Request display capture directly in the click handler before asynchronous audio setup. Theme tokens and base-layer element resets let shadcn component variants control their own surfaces and focus styles.
