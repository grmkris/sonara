# Deploy — Cloudflare DNS + Railway (one project, three app services + Postgres)

> For day-to-day CLI commands, project + service IDs, and migration workflow, see **AGENTS.md §Production**. This doc covers from-scratch deploy wiring (provisioning, variable layout, build-args vs runtime env, DNS).

Public traffic enters via Cloudflare DNS on the `sonara.fm` zone (DNS + TLS edge only, no compute). Everything else runs on Railway via Docker. The **Caddy gateway** is the only public service; `web` and `server` are internal-only.

| Service | Source | Address | Notes |
|---|---|---|---|
| `gateway` (Caddy reverse proxy) | `apps/gateway/Dockerfile` | `https://sonara.fm` (+ `www` → 301) | Path-routes `/api/auth/*`, `/rpc/*`, `/api/upload/*`, `/ws` to `server`; everything else to `web`. |
| `web` (Next.js standalone) | `apps/web/Dockerfile` | `web.railway.internal:4472` | Build args inline `NEXT_PUBLIC_*` into the bundle. |
| `server` (Bun + Hono + WS) | `apps/server/Dockerfile` | `server.railway.internal:4471` | Runs `packages/db` migrator on boot, then binds. Healthcheck `/health`. WSS `/ws`. |
| `Postgres` | Railway Postgres template | `postgres.railway.internal:5432` (private) | Exposed to siblings as `${{Postgres.DATABASE_URL}}`. |

> `api.sonara.fm` still resolves to `server` as a deprecation fallback from the pre-gateway era. The codebase no longer references it. Safe to remove once you confirm no external integration still hits it (CF `CNAME api` + `_railway-verify.api` TXT + the Railway custom domain on `server`).

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
                            ↕
                    fal.ai / AudD / Dodo
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

# Create the three services from GitHub
#   service: gateway → config path apps/gateway/railway.toml (the only public one)
#   service: server  → config path apps/server/railway.toml
#   service: web     → config path apps/web/railway.toml
# (Done via the Railway dashboard; Root Directory = "/" for all three.)

# Add custom domains (only on gateway — server and web are internal-only).
# Prints the CNAME target you point at from CF.
railway domain sonara.fm     --service gateway   # → captures target for apex
railway domain www.sonara.fm --service gateway   # → captures target for www
```

### Cloudflare DNS

In the `sonara.fm` zone (id `3c4eff43a369f04340f8f83efb4870db`), add two CNAMEs (proxied / orange-cloud), pointing at the Railway CNAME targets from the previous step:

| Type | Name | Target | Proxied |
|---|---|---|---|
| CNAME | `@` | Railway target for `gateway` (apex) | ✓ |
| CNAME | `www` | Railway target for `gateway` (www) | ✓ |

> **TXT verification (required behind CF proxy).** When Railway sees a CF-proxied origin it can't validate ownership via CNAME alone, so each `railway domain ...` command also prints a `verificationDnsHost` + `verificationToken`. Run with `--json` to capture both, then add a `TXT` record per domain (e.g. `_railway-verify` for apex). Without these, the domain stays in `CERTIFICATE_STATUS_TYPE_VALIDATING_OWNERSHIP` and Railway responds `404` with `x-railway-fallback: true`.

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
| `APP_ENV` | `prod` (drives every per-env URL via `SERVICE_URLS`, the logger mode, and Dodo live/test mode — set `dev` on the dev environment) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |
| `FAL_KEY` | from fal.ai dashboard |
| `AUDD_API_KEY` | from audd.io |
| `DODO_PAYMENTS_API_KEY` | from Dodo Payments dashboard |
| `DODO_PAYMENTS_WEBHOOK_SECRET` | from Dodo Payments webhook settings |
| `DODO_PRODUCT_STARTER` / `_PRO` / `_MAX` | Dodo product ids for the credit packs |
| `LOG_LEVEL` | `info` |
| `PORT` | `4471` (internal address the gateway proxies to) |

The public origin (Better Auth baseURL/trustedOrigin, checkout return_url) and the Dodo test/live mode are derived from `APP_ENV` via `@sonara/shared` — no `APP_URL` / `DODO_PAYMENTS_MODE` vars.

Leaving the `DODO_*` vars empty silently disables the Dodo plugin + checkout flow; login / anon demo still work. The Dodo webhook is served at `https://sonara.fm/api/auth/dodopayments/webhook`.

### `web` runtime (thin frontend — no DB, no secrets)

| Var | Value |
|---|---|
| `PORT` | `4472` (internal address the gateway proxies to) |

### `web` build-time (Next.js inlines `NEXT_PUBLIC_*` at build time)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_APP_ENV` | `prod` (`dev` on the dev environment) — the WS origin + SSR-internal RPC URL + devtools overlay all derive from it |

### `gateway` runtime

| Var | Value |
|---|---|
| `PORT` | `4470` (also auto-injected by Railway for the public service) |
| `SERVER_URL` | `http://server.railway.internal:4471` |
| `WEB_URL` | `http://web.railway.internal:4472` |

Set via CLI:

```bash
railway variables --service server \
  --set 'APP_ENV=prod' \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" \
  --set 'FAL_KEY=...' --set 'AUDD_API_KEY=...' --set 'LOG_LEVEL=info' \
  --set 'PORT=4471' \
  --set 'DODO_PAYMENTS_API_KEY=...' \
  --set 'DODO_PAYMENTS_WEBHOOK_SECRET=...' \
  --set 'DODO_PRODUCT_STARTER=pdt_...' \
  --set 'DODO_PRODUCT_PRO=pdt_...' \
  --set 'DODO_PRODUCT_MAX=pdt_...'

railway variables --service web \
  --set 'NEXT_PUBLIC_APP_ENV=prod' \
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
3. Deploy `gateway`. Caddyfile templated from `SERVER_URL` / `WEB_URL`; binds on `PORT`.

After this, every push to `main` rebuilds all three services automatically.

---

## Verify

```bash
curl -I https://sonara.fm
# → 200; response header `via: 1.1 Caddy` confirms it went through the gateway

curl https://sonara.fm/api/auth/get-session
# → null (gateway → server auth, no session)

curl -I https://www.sonara.fm
# → 301 → https://sonara.fm

open https://sonara.fm
```

DevTools → Network → WS — confirm `wss://sonara.fm/ws` returns `101`. No mixed-content errors.

---

## Local Docker test

```bash
docker build -f apps/server/Dockerfile -t mv-server .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_APP_ENV=local \
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
