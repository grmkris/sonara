# Deploy — Cloudflare DNS + Railway (three services, one project)

> For day-to-day CLI commands, project + service IDs, and migration workflow, see **AGENTS.md §Production**. This doc covers from-scratch deploy wiring (provisioning, variable layout, build-args vs runtime env, DNS).

Public traffic enters via Cloudflare DNS on the `sonara.fm` zone (DNS + TLS edge only, no compute). Everything else runs on Railway via Docker.

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

### Shared (both `server` and `web`)

| Var | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `BETTER_AUTH_SECRET` | output of `openssl rand -base64 32` |

### `server` runtime only

| Var | Value |
|---|---|
| `FAL_KEY` | from fal.ai dashboard |
| `AUDD_API_KEY` | from audd.io |
| `LOG_LEVEL` | `info` |

(`PORT` is auto-injected — never set manually.)

### `web` runtime

| Var | Value |
|---|---|
| `APP_URL` | `https://sonara.fm` |
| `AUTH_DOMAIN` | `sonara.fm` (no protocol) |

### `web` build-time (must be set BEFORE the build runs — Next.js inlines `NEXT_PUBLIC_*` into the client bundle)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_WS_URL` | `wss://api.sonara.fm/ws` |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | from https://cloud.reown.com |
| `NEXT_PUBLIC_PAY_RECIPIENT_BASE` | Base-chain address that receives USDC top-ups |

Set via CLI:

```bash
railway variables --service server \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" \
  --set 'FAL_KEY=...' --set 'AUDD_API_KEY=...' --set 'LOG_LEVEL=info'

railway variables --service web \
  --set 'DATABASE_URL=${{Postgres.DATABASE_URL}}' \
  --set 'BETTER_AUTH_SECRET=...same...' \
  --set 'APP_URL=https://sonara.fm' \
  --set 'AUTH_DOMAIN=sonara.fm' \
  --set 'NEXT_PUBLIC_WS_URL=wss://api.sonara.fm/ws' \
  --set 'NEXT_PUBLIC_REOWN_PROJECT_ID=...' \
  --set 'NEXT_PUBLIC_PAY_RECIPIENT_BASE=0x...'
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
