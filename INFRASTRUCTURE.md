---
title: "Music Visualizer — Infrastructure"
description: "Topology, data flow, deployment, and external dependencies for the music-visualizer app."
generated: "2026-05-12"
---

# Music Visualizer — Infrastructure

A browser-based realtime AI visualizer. Audio in → ~15 features at 60 Hz → server orchestrates
prompts + generation triggers → fal.ai FLUX.2 returns keyframes → a WebGL2 displacement shader
carries continuity between them at 60 fps.

This document is the **single map of moving parts**: every runtime, network hop, datastore,
and external API the app touches in production.

---

## 1. The 10-second picture

```mermaid
flowchart LR
    User([User<br/>Browser])

    subgraph Railway["Railway project: fearless-nourishment"]
        Web["web<br/>Next.js 16 standalone<br/>(Docker)"]
        Server["server<br/>Bun + Hono + Bun.serve WS<br/>(Docker)"]
        PG[("Postgres<br/>(Railway template)")]
    end

    subgraph External["External APIs"]
        Fal["fal.ai<br/>FLUX.2 klein / schnell"]
        AudD["AudD<br/>song recognition"]
        Apple["Apple Music<br/>track enrichment"]
        Gemini["Google Gemini<br/>(via fal any-llm)<br/>voice-intent parser"]
        Base["Base chain<br/>USDC top-ups (Reown Pay)"]
        Reown["Reown / WalletConnect<br/>SIWE auth"]
    end

    User -- "HTTPS<br/>(Next.js SSR + RSC)" --> Web
    User -- "WSS /ws<br/>oRPC over partysocket" --> Server
    Web -- "HTTPS /rpc<br/>credits, auth, ticket mint" --> Server
    Server --> PG
    Web --> PG

    Server -. "image gen" .-> Fal
    Server -. "fingerprint" .-> AudD
    Server -. "track metadata" .-> Apple
    Server -. "intent parse" .-> Gemini

    User -. "SIWE login" .-> Reown
    User -. "USDC pay" .-> Base
    Web -. "credit ledger sync" .-> PG

    classDef railway fill:#0b0d12,stroke:#7d5fff,color:#fff
    classDef ext fill:#1a1a2e,stroke:#ffa07a,color:#fff
    class Web,Server,PG railway
    class Fal,AudD,Apple,Gemini,Base,Reown ext
```

> **Note.** Everything ships from one git repo (Turborepo monorepo). Two Docker images.
> Three Railway services. Six external APIs. No queue, no Redis, no CDN of our own —
> frames are served as direct fal.ai URLs into `<img>` tags via a WebGL texture upload.

---

## 2. Monorepo layout

```mermaid
graph TD
    Root["music-visualizer/<br/>(Turborepo + Bun workspaces)"]
    Root --> Apps["apps/"]
    Root --> Packages["packages/"]

    Apps --> Web["web<br/>Next.js 16 · React 19 · Tailwind v4<br/>Port 4470"]
    Apps --> ServerApp["server<br/>Bun + Hono · WS · fal-client<br/>Port 4471"]

    Packages --> SharedPkg["shared<br/>zod schemas · event types"]
    Packages --> ApiPkg["api<br/>oRPC routers · client + server entry"]
    Packages --> DbPkg["db<br/>drizzle schema · migrator · SQL files"]
    Packages --> TestUtils["test-utils<br/>pglite helpers"]

    Web -. depends .-> SharedPkg
    Web -. depends .-> ApiPkg
    Web -. depends .-> DbPkg
    ServerApp -. depends .-> SharedPkg
    ServerApp -. depends .-> ApiPkg
    ServerApp -. depends .-> DbPkg
    ApiPkg -. depends .-> SharedPkg

    classDef pkg fill:#0e1a2b,stroke:#5fc7ff,color:#fff
    classDef app fill:#1a0e2b,stroke:#c75fff,color:#fff
    class Web,ServerApp app
    class SharedPkg,ApiPkg,DbPkg,TestUtils pkg
```

| Workspace | Role | Key deps |
|---|---|---|
| `apps/web` | Next.js standalone build, browser bundle, SSR pages | next 16, react 19, zustand, meyda, partysocket, @reown/appkit, viem, wagmi, better-auth |
| `apps/server` | Bun process: Hono HTTP + Bun.serve WebSocket | hono, @orpc/server, @fal-ai/client, pino, pg |
| `packages/shared` | Zod schemas + TS types for every event / state object | zod |
| `packages/api` | oRPC routers (HTTP `/rpc` + WS `/ws` session surface) | @orpc/server, @orpc/client |
| `packages/db` | Drizzle schema (`auth.db.ts`, `credits.db.ts`) + `runMigrations()` boot helper | drizzle-orm, node-postgres |
| `packages/test-utils` | pglite test database helper | drizzle-orm |

---

## 3. Runtime topology

### 3a. Inside the browser

```mermaid
flowchart TB
    subgraph Browser["Browser tab"]
        direction TB
        AudioSrc[("Audio source<br/>mic / file / tab share")]
        AE["AudioEngine<br/>(analyzer.ts)<br/>Web Audio + Meyda"]
        Voice["use-voice-recognition<br/>(browser speech)"]

        Store[("useVisualizerStore<br/>zustand · 6 slices")]

        WS["orpc-ws.ts<br/>RPCLink over<br/>ReconnectingWebSocket"]
        UseWS["use-ws-session.ts<br/>handleEvent(event) switch"]

        Canvas["DisplacementCanvas<br/>WebGL2 · ~900 lines<br/>FBO ping-pong · 50 uniforms"]
        Overlays["CanvasGrain · InkDrops<br/>Oscilloscope · Vignette"]

        AudioSrc -- "60 Hz tick" --> AE
        AE -- "store.setAudio (60 Hz)" --> Store
        AE -- "audioFeatures (5 Hz)" --> WS
        Voice --> WS
        WS <-. "events() iterator<br/>session.*() RPCs" .-> UseWS
        UseWS --> Store
        Store --> Canvas
        Canvas --> Overlays
    end

    classDef live fill:#0a1f0a,stroke:#7fff7f,color:#fff
    classDef store fill:#1f0a1f,stroke:#ff7fff,color:#fff
    class AE,Voice,WS,UseWS,Canvas live
    class Store store
```

### 3b. Inside the server

```mermaid
flowchart TB
    subgraph Bun["Bun process (apps/server)"]
        direction TB
        Boot["server.ts boot<br/>1. runMigrations(DATABASE_URL)<br/>2. Bun.serve({fetch, websocket})"]

        Hono["Hono HTTP router<br/>/health · /rpc/* (credits, auth, ticket)"]
        Upgrade["upgrade handler<br/>verifyTicket(token) → 101"]
        WsHandler["WsRPCHandler<br/>(@orpc/server/bun-ws)"]

        Session["Session<br/>(one per WS, ~690 lines)<br/>state · timers · publisher"]
        Trigger["trigger(reason)<br/>prompt → credit gate → drift → streamPreview"]

        FalProv["fal-provider.ts<br/>streamPreview (single frame)"]
        Recog["recognition/<br/>AudD + Apple Music"]
        Creds["credits/<br/>debitFrame · freeTier · BYOK"]

        Boot --> Hono
        Boot --> Upgrade
        Upgrade --> WsHandler
        WsHandler --> Session
        Session --> Trigger
        Trigger --> Creds
        Trigger --> FalProv
        Session --> Recog
    end

    classDef proc fill:#1a1a0a,stroke:#ffd66f,color:#fff
    class Boot,Hono,Upgrade,WsHandler,Session,Trigger,FalProv,Recog,Creds proc
```

### 3c. Service responsibility table

| Service | Image source | Port | Healthcheck | Stateful? |
|---|---|---|---|---|
| `web` | `apps/web/Dockerfile` (Next.js standalone) | 3000 (Railway maps :443) | HTTP `/` | No |
| `server` | `apps/server/Dockerfile` | `$PORT` (Railway-injected, dev = 4471) | HTTP `/health` → `{"ok":true}` | In-memory only (Session per WS) |
| `Postgres` | Railway template | 5432 (internal) | Railway-managed | **Yes** (auth + credits ledger) |

---

## 4. Data flow — the four hot paths

### 4a. Audio tick (the firehose)

```mermaid
sequenceDiagram
    autonumber
    participant A as AudioEngine (browser)
    participant S as zustand store
    participant W as WS client
    participant Srv as Session (server)
    participant Pub as EventPublisher

    loop every 16ms (60 Hz)
        A->>A: AnalyserNode + Meyda<br/>(RMS, BPM, chroma, …)
        A->>S: setAudio(features)
    end
    loop every 200ms (5 Hz, gated)
        A->>W: session.audioFeatures(payload)
        W->>Srv: applyAudio(features)
        Srv->>Srv: section delta check
        alt section changed
            Srv->>Srv: trigger("section")
            Srv->>Pub: frame.start
            Srv-->>W: frame.start event
            Srv->>Pub: frame.final(url)
            Srv-->>W: frame.final event
            W->>S: setCurrentFrame(url)
        end
    end
```

### 4b. Voice intent

```mermaid
sequenceDiagram
    autonumber
    participant Mic as Browser speech
    participant W as WS client
    participant Srv as Session
    participant LLM as fal any-llm<br/>(Gemini)
    participant T as trigger("voice")

    Mic->>W: session.voicePhrase("paint it blue")
    W->>Srv: applyVoice(text)
    Srv->>Srv: append to buffer, debounce
    Srv->>LLM: parseVoiceIntent(buffer)
    LLM-->>Srv: {kind: "patch", patch: {…}}
    Srv->>T: triggers patch + commit + reset
    T->>T: buildPrompt → credit gate → streamPreview
```

### 4c. Scene commit (manual)

```mermaid
sequenceDiagram
    participant U as User
    participant W as WS client
    participant Srv as Session
    participant Fal as fal.ai FLUX.2

    U->>W: scenePatch + commit
    W->>Srv: session.commit()
    Srv->>Srv: trigger("commit")
    Srv->>Fal: streamPreview(prompt, seed)
    Fal-->>Srv: frame URL
    Srv-->>W: frame.final(url)
```

### 4d. Song recognition (background)

```mermaid
sequenceDiagram
    participant Tab as Tab audio
    participant Srv as Session
    participant Au as AudD
    participant Ap as Apple Music
    participant W as WS client

    Tab->>Srv: 10-second PCM sample (rare)
    Srv->>Au: fingerprint(audio)
    Au-->>Srv: {title, artist, isrc}
    Srv->>Ap: lookup by ISRC
    Ap-->>Srv: artwork, album, genre
    Srv-->>W: nowPlaying event
```

---

## 5. Transport — every wire on the network

| Channel | Protocol | URL | Auth | Direction |
|---|---|---|---|---|
| Web SSR | HTTPS | `https://<web>/` | none (public) | Browser ⇄ web |
| RPC (credits, auth, ticket mint) | HTTPS | `https://<web>/rpc/*` | better-auth cookie | Browser ⇄ web |
| Server RPC | HTTPS | `https://<server>/rpc/*` | better-auth cookie | Web ⇄ server (internal callable) |
| Healthcheck | HTTPS | `https://<server>/health` | none | Railway / curl |
| **Realtime session** | **WSS** | `wss://<server>/ws` | **HMAC ticket** (single-use, minted via RPC) | Browser ⇄ server |
| DB | TCP/TLS | `${{Postgres.DATABASE_URL}}` | password | server, web ⇄ Postgres |
| fal.ai | HTTPS | `https://fal.run/...` | `FAL_KEY` | server → fal |
| AudD | HTTPS | `https://api.audd.io/` | `AUDD_API_KEY` | server → AudD |
| Apple Music | HTTPS | (public) | none | server → Apple |
| Reown Pay | HTTPS | (Reown SDK) | Reown project id | browser → Reown |
| Base USDC | RPC | (viem) | wallet sig | browser → Base |

> **Warning.** WS upgrade is the **only** path that uses a single-use HMAC ticket
> instead of a cookie. The browser RPC-calls `auth.mintWsTicket()` on every reconnect,
> then includes the ticket as a query param. The server verifies on upgrade and
> rejects with 401 otherwise.

---

## 6. Deployment pipeline

```mermaid
flowchart LR
    Dev["Developer<br/>git push main"]
    GH["GitHub<br/>grmkris/music-visualizer"]
    RW["Railway<br/>auto-deploy on push"]

    subgraph Build["Per-service Docker build"]
        direction TB
        BWeb["apps/web/Dockerfile<br/>bun install · next build<br/>(NEXT_PUBLIC_* inlined)"]
        BSrv["apps/server/Dockerfile<br/>bun install · ship src + drizzle/"]
    end

    subgraph Run["Boot"]
        direction TB
        RSrv["server: runMigrations()<br/>then Bun.serve()"]
        RWeb["web: next start (standalone)"]
    end

    Dev --> GH --> RW
    RW --> BWeb --> RWeb
    RW --> BSrv --> RSrv

    classDef step fill:#0e1a0e,stroke:#7fff9f,color:#fff
    class Dev,GH,RW,BWeb,BSrv,RSrv,RWeb step
```

### Build-time vs runtime env

```mermaid
flowchart TB
    subgraph BT["Build time (BEFORE next build)"]
        direction LR
        N1["NEXT_PUBLIC_WS_URL"]
        N2["NEXT_PUBLIC_REOWN_PROJECT_ID"]
        N3["NEXT_PUBLIC_PAY_RECIPIENT_BASE"]
    end

    subgraph RT["Runtime"]
        direction LR
        R1["DATABASE_URL"]
        R2["BETTER_AUTH_SECRET"]
        R3["FAL_KEY"]
        R4["AUDD_API_KEY"]
        R5["LOG_LEVEL"]
        R6["APP_URL · AUTH_DOMAIN"]
        R7["PORT (Railway-injected)"]
    end

    BT -. "inlined into client JS bundle" .-> Browser["client bundle"]
    RT -. "process.env.*" .-> ServerProc["server / web Node processes"]

    classDef build fill:#1a0e0e,stroke:#ff7f7f,color:#fff
    classDef runtime fill:#0e1a1a,stroke:#7fffff,color:#fff
    class N1,N2,N3 build
    class R1,R2,R3,R4,R5,R6,R7 runtime
```

> **Important.** `NEXT_PUBLIC_*` must be set BEFORE the build runs. Next.js
> string-replaces these at compile time. Changing them on Railway after deploy does
> nothing until a fresh build is triggered.

---

## 7. Database

```mermaid
erDiagram
    USER ||--o{ SESSION_TABLE : "owns"
    USER ||--o{ ACCOUNT : "links"
    USER ||--|| CREDITS_BALANCE : "has"
    USER ||--o{ CREDITS_LEDGER : "transacts"
    USER ||--o{ TOPUP : "performs"

    USER {
        text id PK
        text email
        text wallet_address
        timestamp createdAt
    }
    SESSION_TABLE {
        text id PK
        text userId FK
        text token
        timestamp expiresAt
    }
    ACCOUNT {
        text id PK
        text userId FK
        text providerId
    }
    CREDITS_BALANCE {
        text userId PK,FK
        bigint micros
    }
    CREDITS_LEDGER {
        text id PK
        text userId FK
        bigint delta_micros
        text reason
        timestamp createdAt
    }
    TOPUP {
        text id PK
        text userId FK
        text txHash
        bigint amount_usdc
    }
```

- **Schema source:** `packages/db/src/schema/` (`auth.db.ts`, `credits.db.ts`).
- **Migrations:** `packages/db/drizzle/*.sql`, applied by `runMigrations()` on every server boot. **No manual `db:push` in prod.**
- **Author:** drizzle-kit generates SQL from schema diff (`bun run --filter=@music-visualizer/db db:generate`).

---

## 8. External integrations cheat-sheet

| Vendor | Purpose | Auth | Cost shape | Failure mode |
|---|---|---|---|---|
| **fal.ai** | FLUX.2 klein / schnell image gen | `FAL_KEY` (server-held); BYOK fallback per user | ~$0.003 / image · ~20 gens/min/user at intensity 1.0 → **~$0.36 / active-user-minute** | Server emits `frame.error`; client keeps last frame |
| **AudD** | Song fingerprint | `AUDD_API_KEY` | Per-call quota | Silent: `nowPlaying` stays null |
| **Apple Music** | ISRC → artwork / album / genre | none (public iTunes Search) | Free | Silent: partial metadata |
| **Google Gemini** | Voice-intent parser | routed via fal any-llm | Per-token via fal | Voice phrase ignored; user can re-speak |
| **Reown / WalletConnect** | SIWE login, Reown Pay UI | `NEXT_PUBLIC_REOWN_PROJECT_ID` | Free tier | Login blocked; rest of app usable as guest |
| **Base chain** | USDC top-ups to `NEXT_PUBLIC_PAY_RECIPIENT_BASE` | user wallet | L2 gas (negligible) | Top-up fails; ledger unaffected |

---

## 9. Security surface

```mermaid
flowchart LR
    subgraph Public["Internet-facing"]
        WebDom["web.<domain>"]
        SrvDom["server.<domain>"]
    end

    subgraph Tokens["Secrets / Tokens"]
        Cookie["better-auth cookie<br/>HttpOnly · SameSite=Lax"]
        Ticket["HMAC WS ticket<br/>single-use · short TTL"]
        SiweSig["SIWE signature<br/>EIP-191"]
    end

    subgraph Server["Server-only"]
        AuthSecret[".env BETTER_AUTH_SECRET"]
        FalKey[".env FAL_KEY"]
        Audd[".env AUDD_API_KEY"]
        DbUrl[".env DATABASE_URL"]
    end

    WebDom -- "sets" --> Cookie
    Cookie -- "RPC auth" --> SrvDom
    SrvDom -- "mints" --> Ticket
    Ticket -- "WS upgrade" --> SrvDom
    SiweSig -- "verified server-side" --> Cookie

    AuthSecret -. "signs" .-> Cookie
    AuthSecret -. "signs" .-> Ticket

    classDef secret fill:#2b0a0a,stroke:#ff5f5f,color:#fff
    classDef token fill:#2b1a0a,stroke:#ffaf5f,color:#fff
    classDef pub fill:#0a2b1a,stroke:#5fff8f,color:#fff
    class AuthSecret,FalKey,Audd,DbUrl secret
    class Cookie,Ticket,SiweSig token
    class WebDom,SrvDom pub
```

| Asset | Where it lives | Rotation |
|---|---|---|
| `BETTER_AUTH_SECRET` | Railway env (both services, identical) | `openssl rand -base64 32` → re-deploy both |
| `FAL_KEY` | Railway env, **server only** | Rotate in fal.ai dashboard, update env |
| `AUDD_API_KEY` | Railway env, **server only** | Rotate in audd.io, update env |
| WS ticket | Memory only, server signs/verifies, never persisted | TTL ~30s, single use |

---

## 10. Observability & failure modes

| Signal | Source | What it means |
|---|---|---|
| `server` Railway logs | pino structured logs | Every trigger / fal call / credit debit |
| `server.ts` boot lines | `running database migrations` → `migrations applied` → `server listening` | Migration health on each deploy |
| `/health` | Hono route | Liveness for Railway healthcheck |
| `triggerLog` (client store) | events from server | Visible debug trail in dev UI |
| `frame.error` events | fal-provider rejection | Last frame held; user sees no flicker |

### Known degraded paths

1. **fal.ai rate limit / 5xx** → `frame.error` emitted; canvas holds last texture; client keeps shading (audio-reactive but static keyframe).
2. **AudD fail** → `nowPlaying` stays `null`; no UI badge; no behavior change.
3. **WS disconnect** → `partysocket` reconnects with exponential backoff; client re-mints ticket; on re-subscribe, `session.state()` bootstrap pull re-syncs.
4. **DB unreachable on boot** → `runMigrations` throws → process exits → Railway restarts service.
5. **WebGL2 unavailable** → `dream-canvas.tsx` shows "WebGL2 required" overlay (no CSS fallback exists since April 2026).

---

## 11. Cost envelope (back-of-envelope)

```mermaid
pie title Monthly cost mix at ~10 active hours/user/mo
    "fal.ai (Flux-2 klein gen)" : 216
    "Railway hobby (web+srv+pg)" : 5
    "AudD + everything else" : 2
```

> Assumes intensity 1.0 (~20 gens/min) → 12 000 gens/user/mo · $0.003 = $36/user · times some users.
> **fal.ai dominates by two orders of magnitude.** Rate-limit + free-tier gates in
> `apps/server/src/credits/` exist primarily because of this.

---

## 12. What this doc does **not** cover

- **Client-side render pipeline internals** — see `ARCHITECTURE.md` §2b for the WebGL2 displacement shader, FBO ping-pong, Kuwahara pass, and 21 named presets.
- **Session state machine** — see `ARCHITECTURE.md` §2f for the trigger reasons and how `trigger()` funnels them into a single `streamPreview` call.
- **Refactor backlog** — see `ARCHITECTURE.md` §3 (smell list) and §4 (cleanup order).
- **Repo conventions for contributors** — see `AGENTS.md`.

---

> **Mental model in one line:** the browser does the rendering and audio analysis;
> the server is a thin *orchestrator* that turns scene + audio + voice into fal.ai
> prompts and emits events back; Postgres only stores auth + credits. Everything
> else is in-memory per WebSocket connection.
