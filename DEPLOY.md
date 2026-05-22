# Deploy — Cloudflare DNS + Railway (three services, one project)

> For day-to-day CLI commands, project + service IDs, and migration workflow, see **AGENTS.md §Production**. This doc covers from-scratch deploy wiring (provisioning, variable layout, build-args vs runtime env, DNS).

Public traffic enters via Cloudflare DNS on the `sonara.fm` zone (DNS + TLS edge only, no compute). Everything else runs on Railway via Docker.

> **Note — the tables/diagram immediately below describe the *pre-gateway* topology that may still be live.** The current codebase expects the **Caddy gateway** topology; see **`## Gateway cutover`** below for the new layout and the one-time migration steps. After cutover, the `web` and `server` services are internal-only and a new `gateway` service is the single public entry.

| Service | Source | Public URL | Notes |
|---|---|---|---|
| `server` (Bun + Hono + WS) | `apps/server/Dockerfile` | `https://api.sonara.fm` | Runs `packages/db` migrator on boot, then binds. Healthcheck `/health`. WSS `/ws`. |
| `web` (Next.js standalone) | `apps/web/Dockerfile` | `https://sonara.fm` | Build args inline `NEXT_PUBLIC_*` into the bundle. |
| `Postgres` | Railway Postgres template | `postgres.railway.internal:5432` (private) | Exposed to siblings as `${{Postgres.DATABASE_URL}}`. |

```
                       Browser
                          │
                          ▼
           ┌──────────────────────────────┐
           │  Cloudflare DNS (sonara.fm)  │
           │  - @, www, api  (proxied)    │
           │  - SSL Full (strict)         │
           └──────────────┬───────────────┘
                          │
       ┌──────────────────┴──────────────────┐
       ▼                                     ▼
 sonara.fm                            api.sonara.fm
       │                                     │
┌──────┴──────────────────────────────────────┴──────┐
│   Railway project: sonara                          │
│                                                    │
│   ┌─────────┐                  ┌──────────┐        │
│   │   web   │                  │  server  │        │
│   │ (Next)  │                  │ (Bun/WS) │        │
│   └────┬────┘                  └────┬─────┘        │
│        │                            │              │
│        └──────────────┬─────────────┘              │
│                       ▼                            │
│                 ┌──────────┐                       │
│                 │ Postgres │                       │
│                 └──────────┘                       │
└────────────────────────────────────────────────────┘
                         ↕
                 fal.ai / AudD
```

---

## Gateway cutover

The single source of truth is now the **server**; the **web** app is a thin frontend. A **Caddy gateway** (`apps/gateway`, `caddy:2-alpine`) becomes the only public service and path-routes the browser's requests to web vs server over Railway's internal network — so everything is same-origin (cookies first-party, no CORS). New target topology:

```
                    Browser
                       │  https://sonara.fm  +  wss://sonara.fm/ws
                       ▼
            Cloudflare DNS (sonara.fm, proxied)
                       │
                       ▼
        ┌──────────────────────────────────┐
        │  gateway  (Caddy)  ← only public  │
        │   /api/auth/*  /rpc/*             │
        │   /api/upload/*  /ws   → server   │
        │   everything else      → web      │
        └───────┬───────────────────┬───────┘
        web.railway.internal:4472  server.railway.internal:4471
                │                       │
                └───────────┬───────────┘
                            ▼
                        Postgres
```

**Steps (run once; safe order to avoid downtime):**

1. **Create the `gateway` service** from `apps/gateway/Dockerfile` (Root Directory `/`). Set vars:
   ```bash
   railway variables --service gateway \
     --set 'PORT=4470' \
     --set 'SERVER_URL=http://server.railway.internal:4471' \
     --set 'WEB_URL=http://web.railway.internal:4472'
   ```
   Make sure `server` listens on `4471` and `web` on `4472` internally (set `PORT`/`--port` accordingly; Railway also auto-injects `PORT` to the gateway).
2. **Move secrets web → server.** Set on `server`: `APP_URL=https://sonara.fm`, and all `DODO_PAYMENTS_*` / `DODO_PRODUCT_*`. (`FAL_KEY`, `AUDD_API_KEY`, `BETTER_AUTH_SECRET`, `DATABASE_URL` are already on `server`.) Then **remove** `DATABASE_URL`, `BETTER_AUTH_SECRET`, `APP_URL`, `AUTH_DOMAIN`, `FAL_KEY`, `DODO_*` from `web`.
3. **Set `web` runtime + rebuild vars:** `RPC_INTERNAL_URL=http://server.railway.internal:4471` and **rebuild-time** `NEXT_PUBLIC_WS_URL=wss://sonara.fm/ws`.
4. **Update the Dodo webhook URL** in the Dodo dashboard to `https://sonara.fm/api/auth/dodopayments/webhook` (Better Auth serves it; the gateway routes `/api/auth/*` to the server).
5. **Deploy order:** server → web → gateway.
6. **Cloudflare:** point `CNAME @` (and `www`) at the **gateway**'s Railway CNAME target. `api.sonara.fm` is no longer needed (WSS is now `wss://sonara.fm/ws`); keep it pointed at `server` only if you want a fallback during the window, otherwise remove it + its `_railway-verify.api` TXT.
7. **Verify** (see the `## Verify` section, gateway-origin variants):
   ```bash
   curl -I https://sonara.fm                      # 200 (gateway → web)
   curl https://sonara.fm/api/auth/get-session    # null (gateway → server auth)
   # DevTools → Network → WS: wss://sonara.fm/ws → 101
   ```

---

## How migrations apply on deploy

There is **no manual `db:push` step**. Schema is owned by `packages/db` and applied on every server boot:

- `packages/db/src/migrator.ts` — `runMigrations(databaseUrl)` using `drizzle-orm/node-postgres/migrator`.
- `apps/server/src/server.ts` — calls `runMigrations(env.DATABASE_URL)` before `Bun.serve(...)`. Mirror of ai-stilist, zednabi-v2, invok admin-api.
- SQL files live at `packages/db/drizzle/` and are bundled into the server Docker image.

To add a migration:

```bash
# 1. Edit schema in packages/db/src/schema/
# 2. Generate the SQL
bun run --filter=@sonara/db db:generate
# 3. Commit both the schema change AND the new file in packages/db/drizzle/
# 4. Push — server applies it on next deploy
```

---

## First-time project setup

The Railway project already exists at `https://railway.com/project/33e35438-b78d-4cf9-8fe6-d0ba87e3c111`. For a brand-new project:

```bash
# Authenticate + link
railway login
railway link --project <id>

# Provision Postgres
railway add --database postgres

# Create the two services from GitHub
#   service: server  → config path apps/server/railway.toml
#   service: web     → config path apps/web/railway.toml
# (Done via the Railway dashboard; Root Directory = "/" for both.)

# Add custom domains (prints the CNAME target you'll point at from CF)
railway domain sonara.fm     --service web      # → captures target for apex
railway domain www.sonara.fm --service web      # → captures target for www
railway domain api.sonara.fm --service server   # → captures target for server
```

### Cloudflare DNS

In the `sonara.fm` zone (id `3c4eff43a369f04340f8f83efb4870db`), add three CNAMEs (all proxied / orange-cloud), pointing at the Railway CNAME targets from the previous step:

| Type | Name | Target | Proxied |
|---|---|---|---|
| CNAME | `@` | Railway target for `web` (apex) | ✓ |
| CNAME | `www` | Railway target for `web` (www) | ✓ |
| CNAME | `api` | Railway target for `server` | ✓ |

> **TXT verification (required behind CF proxy).** When Railway sees a CF-proxied origin it can't validate ownership via CNAME alone, so each `railway domain ...` command also prints a `verificationDnsHost` + `verificationToken`. Run with `--json` to capture both, then add a `TXT` record per domain (e.g. `_railway-verify` for apex, `_railway-verify.api` for `api.`). Without these, the domain stays in `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP` and Railway responds `404` with `x-railway-fallback: true`.

Then in the zone:

- **SSL/TLS** → mode **Full (strict)**
- **SSL/TLS → Edge Certificates** → **Always Use HTTPS** on, **Automatic HTTPS Rewrites** on
- **Rules → Page Rules** → create one: pattern `www.sonara.fm/*`, action *Forwarding URL*, status `301`, destination `https://sonara.fm/$1`

Railway issues Let's Encrypt certs against the custom domains automatically once the TXT verification clears — the certificate state moves from `VALIDATING_OWNERSHIP` to `READY` within a minute or two.

---

## Variables

Generate the auth secret once:

```bash
openssl rand -base64 32
```

> Ownership reflects the gateway topology: **all secrets live on `server`**; `web` is a thin frontend with no DB and no secrets; `gateway` only knows the two internal addresses.

### `server` runtime (the single source of truth — all secrets here)

| Var | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
| `FAL_KEY` | from fal.ai dashboard |
| `AUDD_API_KEY` | from audd.io |
| `APP_URL` | `https://sonara.fm` (public gateway origin — Better Auth baseURL + checkout return_url) |
| `DODO_PAYMENTS_API_KEY` | from Dodo Payments dashboard |
| `DODO_PAYMENTS_WEBHOOK_SECRET` | from Dodo Payments webhook settings |
| `DODO_PAYMENTS_MODE` | `test_mode` or `live_mode` |
| `DODO_PRODUCT_STARTER` / `_PRO` / `_MAX` | Dodo product ids for the credit packs |
| `LOG_LEVEL` | `info` |
| `PORT` | `4471` (internal address the gateway proxies to) |

Leaving the `DODO_*` vars empty silently disables the Dodo plugin + checkout flow; login / anon demo still work. The Dodo webhook is served at `https://sonara.fm/api/auth/dodopayments/webhook`.

### `web` runtime (thin frontend — no DB, no secrets)

| Var | Value |
|---|---|
| `RPC_INTERNAL_URL` | `http://server.railway.internal:4471` (SSR-only oRPC; no window to read the gateway origin) |
| `PORT` | `4472` (internal address the gateway proxies to) |

### `web` build-time (Next.js inlines `NEXT_PUBLIC_*` at build time)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_WS_URL` | `wss://sonara.fm/ws` (same-origin through the gateway) |

### `gateway` runtime

| Var | Value |
|---|---|
| `PORT` | `4470` (also auto-injected by Railway for the public service) |
| `SERVER_URL` | `http://server.railway.internal:4471` |
| `WEB_URL` | `http://web.railway.internal:4472` |

Set via CLI:

```bash
railway variables --service server \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" \
  --set 'FAL_KEY=...' --set 'AUDD_API_KEY=...' --set 'LOG_LEVEL=info' \
  --set 'APP_URL=https://sonara.fm' --set 'PORT=4471' \
  --set 'DODO_PAYMENTS_API_KEY=...' \
  --set 'DODO_PAYMENTS_WEBHOOK_SECRET=...' \
  --set 'DODO_PAYMENTS_MODE=live_mode' \
  --set 'DODO_PRODUCT_STARTER=pdt_...' \
  --set 'DODO_PRODUCT_PRO=pdt_...' \
  --set 'DODO_PRODUCT_MAX=pdt_...'

railway variables --service web \
  --set 'RPC_INTERNAL_URL=http://server.railway.internal:4471' \
  --set 'NEXT_PUBLIC_WS_URL=wss://sonara.fm/ws' \
  --set 'PORT=4472'

railway variables --service gateway \
  --set 'PORT=4470' \
  --set 'SERVER_URL=http://server.railway.internal:4471' \
  --set 'WEB_URL=http://web.railway.internal:4472'
```

---

## First deploy order

1. Deploy `server`. On boot, logs show `running database migrations` → `migrations applied` → `server listening`. Watch with `railway logs --service server`.
2. Deploy `web`. Standalone Next.js build is wired with the inlined `NEXT_PUBLIC_*` at build time.

After this, every push to `main` rebuilds both services automatically.

---

## Verify

```bash
curl https://api.sonara.fm/health
# → {"ok":true}

curl -I https://sonara.fm
# → 200

curl -I https://www.sonara.fm
# → 301 → https://sonara.fm

open https://sonara.fm
```

DevTools → Network → WS — confirm `wss://api.sonara.fm/ws` returns `101`. No mixed-content errors.

---

## Local Docker test

```bash
docker build -f apps/server/Dockerfile -t mv-server .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_WS_URL=ws://localhost:4471/ws \
  -t mv-web .

docker run --rm -p 4471:4471 --env-file .env mv-server
docker run --rm -p 4470:3000 --env-file .env mv-web
```

---

## Rollback

```bash
# Railway UI: service → Deployments → previous deployment → Redeploy
# or via CLI:
railway redeploy --service server --deployment <id>
```

---

## Cost notes

- Railway: $5/mo hobby plan covers all three services with room to spare.
- fal.ai: pay-per-image. At intensity 1.0 (~20 gens/min/user) on Flux-2/klein (~$0.003/image) → **~$0.36 per active-user-minute**. Add rate limits before sharing publicly.
- Railway Postgres: covered by the hobby plan for this workload.
