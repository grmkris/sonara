# Deploy (Shape A — per-user ephemeral)

Two pieces, two hosts:

| Component | Host | Why |
|---|---|---|
| `apps/web` (Next.js) | Vercel | Next's native platform; zero-config |
| `apps/server` (Bun + WS) | Fly.io | Supports Bun + WebSockets + keeps connections open |

Vercel's serverless model can't host the WebSocket server — that's why the server goes to Fly.

---

## 1. Server → Fly.io

### One-time setup

```bash
# Install Fly CLI
curl -L https://fly.io/install.sh | sh

# Log in (opens a browser)
fly auth login

# From the repo root:
fly launch --no-deploy
# - Pick an app name (e.g. `music-visualizer-server`) — update fly.toml to match
# - Pick a region (iad = Virginia; lhr = London; fra = Frankfurt; etc.)
# - When it asks about a Postgres/Redis/Tigris cluster: no to all.
```

`fly launch` will read the existing `fly.toml` and `Dockerfile` at the repo root — don't let it overwrite them.

### Set the one secret

```bash
fly secrets set FAL_KEY=your_fal_key_here

# Optional: override the LLM model used for drift synthesis.
# Default is google/gemini-2.5-flash-lite.
fly secrets set FAL_LLM_MODEL=openai/gpt-4o-mini
```

### Deploy

```bash
fly deploy
```

Fly builds the image using `Dockerfile`, pushes it, and releases it. Takes ~2 minutes the first time. You'll get a URL like `https://music-visualizer-server.fly.dev`.

**Verify:**
```bash
curl https://music-visualizer-server.fly.dev/health
# → {"ok":true}
```

---

## 2. Web → Vercel

### Via dashboard (easiest)

1. Push the repo to GitHub (if not already).
2. https://vercel.com/new → import the repo.
3. Set **Root Directory** to `apps/web`.
4. Framework preset should auto-detect as Next.js.
5. Add one env var:
   - `NEXT_PUBLIC_WS_URL` = `wss://music-visualizer-server.fly.dev/ws`
   (replace with your actual fly.dev hostname — note **wss://** not ws://)
6. Deploy. First build takes ~2 minutes.

### Or via CLI

```bash
npm i -g vercel
cd apps/web
vercel                                # first time, creates project
vercel env add NEXT_PUBLIC_WS_URL     # paste the wss:// URL
vercel --prod                         # ship to production
```

---

## 3. Verify end-to-end

Open the Vercel URL in Chrome. Expect:
- 夢 ideogram pulses (empty state) → you haven't generated anything yet.
- WS indicator in the HUD shows a paper-coloured dot (connected). Red dot = server unreachable.
- Type a subject, press Enter → image starts arriving within ~1–2s.
- Fly cold-start: if the server has been idle, first-ever page load may take ~5s before WS connects. Subsequent loads are instant.

Browser dev console should show no mixed-content errors. If you see `ws://` in the connection URL, Vercel's env var didn't take — check it was set for Production scope.

---

## Cost ballpark

- **Vercel Hobby**: free. Unlimited bandwidth for Next.
- **Fly.io**: free tier covers 3 shared-cpu-1x / 512MB machines. This app uses 1. Outbound bandwidth 160 GB free, then ~$0.02/GB. Realistically free for a demo.
- **fal.ai**: pay-per-call. With one active user at intensity 1.0 (regen every 3s), that's ~20 fal image calls/minute. Flux-2/klein is roughly $0.003/image → **~$0.36/minute of active use per user**. LLM drift calls are pennies on top. If the app goes semi-viral, this is the line item you'll watch.

There's no rate limiting in the server code — any connected WebSocket burns your FAL_KEY. For a shareable demo, add a global max-generations-per-session-per-minute counter before exposing it widely. Ask and I'll add one.

---

## Updating

```bash
# Server
fly deploy

# Web (Vercel auto-deploys from git if you connected the repo in step 2)
git push
# OR manually:
cd apps/web && vercel --prod
```

---

## Rollback

```bash
# Server
fly releases                          # list previous releases
fly releases rollback <version>

# Web
vercel rollback <deployment-url>      # or use the Vercel dashboard
```

---

## Shutting it down

```bash
fly apps destroy music-visualizer-server   # server (stops billing)
# Vercel: delete project in dashboard — or just let it sit (free).
```
