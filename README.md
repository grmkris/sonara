# Music Visualizer — Dreamlike Realtime AI

Browser-based visualizer. Text prompt + music → continuously flowing, dreamlike AI-generated visuals. AI supplies keyframes via fal.ai FLUX.2 [klein]; the browser carries continuity with a 60 fps render loop, crossfade + CSS filters + framer-motion drift modulated by live audio features.

## Stack

- **Web** (`apps/web`): Next.js 16, React 19, Tailwind v4, shadcn/ui, zustand, framer-motion, Meyda
- **Server** (`apps/server`): Bun + Hono + native `Bun.serve` WebSocket, `@fal-ai/client`, pino
- **Shared** (`packages/shared`): zod schemas + TS types for all events and state

## Run

```bash
cp .env.example .env
# set FAL_KEY

bun install
bun run dev
```

- Web: http://localhost:3000
- Server: ws://localhost:3001/ws

## Scripts

- `bun run dev` — both apps in parallel (Turborepo)
- `bun run dev:web` — web only
- `bun run dev:server` — server only
- `bun run typecheck` — strict TS across the workspace

## Architecture

```
Browser                              Server                      fal.ai
───────                              ──────                      ──────
<audio>/mic → AnalyserNode + Meyda
     ↓ 60 Hz
RenderState (damped toward audio-
derived targets) drives <canvas>
     ↓
Crossfade + CSS filters on <img>
    buffers between AI keyframes
     ↑
WS client ← scene.patch, audio.features (5 Hz) →  Session manager
                                                    ↓ scheduler
                                                    ↓ (pause/semantic/
                                                    ↓  periodic/section)
                                                   fal.stream(klein,
                                                     img2img) ───────→
                                                   ← partial frames ←
                                 frame.preview/final  ↓
            crossfade ← ←  ←  ←  ←  ← ← ← ← ← ← ← ←
```

Previous frame is fed back as `image_url` on every keyframe — this is what makes the visuals *flow* instead of hard-cut.

## Scope

**In MVP**: text prompts + music (file or mic) → dreamlike visuals.
**Phase 2 (not here)**: voice via OpenAI Realtime, WebGL shader renderer, OpenAI refine pass.
