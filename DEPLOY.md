# Deploy — Railway (two services, one project)

Everything runs on Railway via Docker. No Fly, no Vercel.

| Service | Dockerfile | Railway config |
|---|---|---|
| `server` (Bun + Hono + WS) | `apps/server/Dockerfile` | `apps/server/railway.toml` |
| `web` (Next.js standalone) | `apps/web/Dockerfile` | `apps/web/railway.toml` |

Postgres lives externally on Neon (Railway's Postgres addon works too — pick one).

```
┌─────────────────────────────────────┐
│   Railway project: music-visualizer │
│                                     │
│   ┌─────────┐      ┌──────────┐     │
│   │   web   │─────▶│  server  │     │
│   │ (Next)  │  WS  │ (Bun/WS) │     │
│   └─────────┘      └─────┬────┘     │
└────────────────────────── │ ────────┘
                            ▼
                    Neon Postgres
                    fal.ai / AudD
```

---

## 1. Create the Railway project

```bash
# https://railway.app/new → "Deploy from GitHub repo" → pick this repo
```

Create **two services** from the same repo:

### Service: `server`
- **Settings → Source**: Root Directory `/`, Config-as-code Path `apps/server/railway.toml`
- **Settings → Networking**: generate a public domain (`*.up.railway.app`)
- **Healthcheck**: `/health` (already wired in `railway.toml`)

### Service: `web`
- **Settings → Source**: Root Directory `/`, Config-as-code Path `apps/web/railway.toml`
- **Settings → Networking**: generate a public domain

The repo root stays the build context for both — Dockerfiles need it for workspace resolution.

---

## 2. Set variables

### Shared (both services)

Create these as **shared variables** in the project and reference them from each service.

| Var | Value |
|---|---|
| `DATABASE_URL` | Neon pooler URL (`?sslmode=require`) |
| `BETTER_AUTH_SECRET` | 32+ random bytes — `openssl rand -base64 32` |

### `server` only

| Var | Value |
|---|---|
| `FAL_KEY` | from fal.ai dashboard |
| `AUDD_API_KEY` | from audd.io |
| `LOG_LEVEL` | `info` |
| `PORT` | auto-injected by Railway — **do not set manually** |

### `web` runtime vars

| Var | Value |
|---|---|
| `APP_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `AUTH_DOMAIN` | `${{RAILWAY_PUBLIC_DOMAIN}}` (no protocol) |
| `PORT` | auto-injected by Railway |

### `web` build args (Settings → Build → Build Args)

Next.js inlines `NEXT_PUBLIC_*` vars **at build time**, so these must be build args — not runtime variables.

| Arg | Value |
|---|---|
| `NEXT_PUBLIC_WS_URL` | `wss://<server-public-domain>/ws` — fill after first server deploy |
| `NEXT_PUBLIC_REOWN_PROJECT_ID` | from https://cloud.reown.com |
| `NEXT_PUBLIC_PAY_RECIPIENT_BASE` | Base-chain address for USDC top-ups |

---

## 3. First deploy order

1. Deploy `server` first. Wait for green healthcheck, copy its public domain (`music-visualizer-server-production.up.railway.app` or whatever Railway assigns).
2. Set `web`'s `NEXT_PUBLIC_WS_URL=wss://<that-domain>/ws` as a build arg.
3. Deploy `web`. Open its public domain in a browser.

After this, every GitHub push rebuilds both services automatically.

---

## 4. Verify

```bash
# Server health
curl https://<server-domain>/health
# → {"ok":true}

# Web
open https://<web-domain>
```

Browser devtools → Network → WS tab should show `wss://<server>/ws` with a 101 status. No mixed-content errors.

---

## Local Docker test

Before pushing, smoke-test the images locally:

```bash
# From repo root
docker build -f apps/server/Dockerfile -t mv-server .
docker build -f apps/web/Dockerfile \
  --build-arg NEXT_PUBLIC_WS_URL=ws://localhost:4471/ws \
  -t mv-web .

docker run --rm -p 4471:4471 --env-file .env mv-server
# in another terminal:
docker run --rm -p 4470:3000 --env-file .env mv-web
```

---

## Rollback

```bash
# Railway UI: service → Deployments → click a previous deployment → Redeploy
# or via CLI:
railway redeploy --service server --deployment <id>
```

---

## Cost notes

- Railway: $5/mo hobby plan covers both services with room to spare for this workload. Metered by usage — WebSocket idle is near-free.
- fal.ai: pay-per-image. At intensity 1.0 (~20 gens/min/user) on Flux-2/klein (~$0.003/image) → **~$0.36 per active-user-minute**. Add rate limits before sharing publicly.
- Neon: free tier is plenty for credits ledger + SIWE nonces.
