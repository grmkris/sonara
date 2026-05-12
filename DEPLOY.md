# Deploy — Railway (three services, one project)

Everything runs on Railway via Docker.

| Service | Source | Notes |
|---|---|---|
| `server` (Bun + Hono + WS) | `apps/server/Dockerfile` | Runs `packages/db` migrator on boot, then binds. Healthcheck `/health`. |
| `web` (Next.js standalone) | `apps/web/Dockerfile` | Build args inline `NEXT_PUBLIC_*` into the bundle. |
| `Postgres` | Railway Postgres template | Exposed to siblings as `${{Postgres.DATABASE_URL}}`. |

```
┌─────────────────────────────────────┐
│   Railway project: fearless-…       │
│                                     │
│   ┌─────────┐      ┌──────────┐     │
│   │   web   │─────▶│  server  │     │
│   │ (Next)  │  WS  │ (Bun/WS) │     │
│   └────┬────┘      └────┬─────┘     │
│        │                │           │
│        └──────┬─────────┘           │
│               ▼                     │
│         ┌──────────┐                │
│         │ Postgres │                │
│         └──────────┘                │
└─────────────────────────────────────┘
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
bun run --filter=@music-visualizer/db db:generate
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

# Generate domains
railway domain --service server
railway domain --service web
```

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
| `APP_URL` | `https://<web-public-domain>` |
| `AUTH_DOMAIN` | `<web-public-domain>` (no protocol) |

### `web` build-time (must be set BEFORE the build runs — Next.js inlines `NEXT_PUBLIC_*` into the client bundle)

| Var | Value |
|---|---|
| `NEXT_PUBLIC_WS_URL` | `wss://<server-public-domain>/ws` |
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
  --set 'APP_URL=https://<web-domain>' \
  --set 'AUTH_DOMAIN=<web-domain>' \
  --set 'NEXT_PUBLIC_WS_URL=wss://<server-domain>/ws' \
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
curl https://<server-domain>/health
# → {"ok":true}

open https://<web-domain>
```

DevTools → Network → WS — confirm `wss://<server>/ws` returns `101`. No mixed-content errors.

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
