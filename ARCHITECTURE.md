# Architecture & Cleanup Notes

A code tour for refactoring decisions. Read top-down: data flow first, then a layer-by-layer map with file paths, then an honest list of where complexity has accumulated and what to do about it.

> **Backend unification (May 2026):** the API **server** is the single source of truth — Better Auth, the oRPC HTTP router (credits, `mintWsTicket`), image upload, and the Dodo webhook all moved out of the Next.js app into `apps/server/src/{auth,rpc,http}/`. A **Caddy gateway** (`apps/gateway`) fronts both and makes everything same-origin (cookies first-party, no CORS). The web app is a thin frontend — no DB, no secrets. See `AGENTS.md §Quick orient` + `DEPLOY.md`. Per-layer paths below that say `apps/web/src/server/*` now live under `apps/server/`.

> **Status at last update (2026-06-01):**
> - ✅ Gateway cutover live in prod — `https://sonara.fm` resolves to the `gateway` service; `via: 1.1 Caddy` on every response.
> - ✅ Scene state collapsed to a single `prompt` field (`SonaraSceneState` in `packages/shared/src/scene.ts`); song-muse outputs `{ prompt }`; the per-field UI (`field-row.tsx`, `scene-fields.ts`) is deleted.
> - ✅ Image-anchor upload shipped end-to-end: `apps/server/src/http/upload.ts`, `apps/server/src/generation/anchor-provider.ts`, `setImageAnchor` mutation, `image-anchor-zone.tsx`, third trigger branch in `session.ts`.
> - ✅ Demo image library + decks; anon sessions pinned to demo-library mode (no fal, no credits).
> - ✅ Public demo without signup; email allowlist removed.
> - ✅ Dodo Payments wired (SIWE/Reown/USDC ripped out in `b906ac4`).
> - ✅ CSS fallback renderer deleted; Papari–Kuwahara painterly pass; `uSalt`/`uCauliflower`/`uSplatter` primitives.
> - ⚠️ **Smell #1 worse, not better.** `session.ts` is now **1016 lines** (was 687 at last note). Voice handling, image-anchor branch, demo-library branch, and the song-muse hook all accreted there. Worth a focused extraction pass.
> - ❌ Lygia refactor dropped (license incompatible).

Open cleanup items are tracked in §3 (smell list) below. The visual / shader refactor list — which used to live in `REFACTOR-PLAN.md` — closed out and the file has been retired.

---

## 1. Data flow in one picture

```
                          ┌──────────────────── BROWSER ────────────────────┐
                          │                                                  │
  audio source ──┐        │   AudioEngine (analyzer.ts)                      │
  (mic/file/tab) │  60Hz  │   ├─ Web Audio AnalyserNode + Meyda              │
                 ├────────┼─→ ├─ RMS, BPM, onset, valence, arousal, chroma   │
                 │        │   └─ tick callback                               │
                 │        │       ├─ store.setAudio(features)    [60 Hz]     │
                 │        │       └─ sessionClient.audioFeatures [ 5 Hz]     │
                 │        │                                                  │
  voice mic   ───┘        │   use-voice-recognition → sessionClient.voicePhrase
                          │   prompt input          → sessionClient.scenePatch
                          │   commit button         → sessionClient.commit   │
                          │                                                  │
                          │   WS /ws  (orpc-ws.ts + partysocket)             │
                          │   RPCLink over ReconnectingWebSocket             │
                          │       ↓                       ↑                  │
                          │   client.events() iterator  session.<proc>() RPCs│
                          │       ↓                                          │
                          │   use-ws-session.ts   ← handleEvent(event) switch│
                          │       ↓                                          │
                          │   useVisualizerStore  ← single zustand store     │
                          │       ↓                                          │
                          │   DisplacementCanvas (WebGL2)                    │
                          │   ├─ subscribes to currentFrame, uploads texture │
                          │   ├─ 60 Hz RAF tick → reads store + audio        │
                          │   ├─ shader pass: 30+ uniforms, 13 presets       │
                          │   ├─ feedback FBO ping-pong, RD overlay          │
                          │   └─ reveal-from-noise gate at end of shader     │
                          └──────────────────────────────────────────────────┘
                                              ↕  WebSocket /ws
                          ┌──────────────────── BUN SERVER ──────────────────┐
                          │                                                  │
                          │   server.ts ─ Hono + Bun.serve websocket         │
                          │     ├─ verifyTicket(token) on upgrade            │
                          │     └─ WsRPCHandler (@orpc/server/bun-ws) routes │
                          │        session.* procedures from packages/api   │
                          │                                                  │
                          │   Session (one per WS connection, ~620 lines)    │
                          │   ├─ State: scene, lastGeneratedScene, hero,     │
                          │   │         seed, audio digest, voice buffer,    │
                          │   │         atmosphere, ~6 timers/inflights      │
                          │   ├─ applyPatch  → semanticDiff → maybe trigger  │
                          │   ├─ applyAudio  → section delta → maybe trigger │
                          │   ├─ commit      → trigger("commit")             │
                          │   ├─ applyVoice  → debounce → parseVoiceIntent   │
                          │   │                  (fal-ai/any-llm + gemini)   │
                          │   │              → patch/commit/reset/preset     │
                          │   ├─ periodic timer → maybe trigger("periodic")  │
                          │   └─ trigger(reason):                            │
                          │       ├─ buildPrompt(scene)                      │
                          │       ├─ credit gate (debitFrame/freeTier/BYOK)  │
                          │       ├─ drift layering (LLM/voice/static pool)  │
                          │       └─ streamPreview (single frame, every time)│
                          │                                                  │
                          │   fal-provider.ts                                │
                          │   └─ streamPreview      (1 call, FLUX.2 klein)   │
                          └──────────────────────────────────────────────────┘
                                              ↕
                                            fal.ai
```

---

## 2. Layer-by-layer

### 2a. Audio in
`apps/web/src/lib/audio/analyzer.ts`

- One `AudioContext` for life of app. `attachElement` / `attachMic` / `attachDisplay` hot-swap sources without tearing down.
- Computes RMS + centroid in-loop (so it never stalls if Meyda fails). Meyda supplies flatness/rolloff/flux/chroma.
- Derives BPM via autocorrelation on flux history; latches `bpmPhase` per frame.
- Fires `tick(features)` at ~60 Hz; `useAudioFeatures` writes to store and forwards to WS at 5 Hz, gated by `musicality-gate.ts`.

**This file is good. Self-contained, well-commented. Leave it.**

### 2b. Render
`apps/web/src/components/visualizer/dream-canvas.tsx` (now ~65 lines, WebGL2-only)
- Always mounts `DisplacementCanvas`, `CanvasGrain`, `InkDrops`, `CanvasOscilloscope`, vignette div, `EmptyIdeogram`.
- Shows a "WebGL2 required" overlay if the context is unavailable (SSR-safe: renders normal tree during `hasWebgl2 === null`).

`displacement-canvas.tsx` (~800 lines) is the heart:
- Subscribes to `currentFrame`, uploads to `slotA`/`slotB` ping-pong textures.
- Subscribes to `presetTick`, runs preset crossfade (3.5 s easeOutBack).
- Owns: drift LFOs, glitch-peek scheduler, reaction-diffusion layer, FBO ping-pong feedback, reveal-from-noise timing.
- 60 Hz RAF: reads audio from store, computes targets, smooths via VU envelopes, pushes ~50 uniforms.

`displacement-shaders.ts` (~750 lines GLSL):
- One vertex shader, one monolithic fragment shader.
- Pipeline order documented at line 34.
- 31+ uniforms gated by float "off when 0" pattern. 21 named visual presets in `presets.ts` set those uniforms.
- Includes Papari–Kuwahara painterly filter (`uPainterly`) and reveal-from-noise gate (`uRevealActive`, `uRevealT`).

### 2c. Store
`apps/web/src/stores/visualizer-store.ts` — single zustand store, ~25 fields:
- **Render**: scene, audio, previousFrame, currentFrame, crossfadeStartedAt, latestVersion
- **Session**: status, statusMessage, connected, triggerLog, commitPulse, sweepPulse
- **Presets**: preset, presetMode, presetCycleMs, presetTick, savedPresets, customPreset, lastEffective
- **Banks**: heroBank, nowPlaying, identifyTick
- **UI**: uiVisible

### 2d. Transport
`apps/web/src/lib/orpc-ws.ts` — partysocket `ReconnectingWebSocket` wrapped by `@orpc/client/websocket`'s `RPCLink`. URL provider mints a fresh HMAC ticket via `rpcClient.auth.mintWsTicket()` on every reconnect.

`apps/web/src/lib/session-actions.ts` — thin client-side dispatch shim. `SessionAction` discriminated union + `dispatchSessionAction()` so call sites keep the familiar `send({type, ...})` ergonomics without a wire-level union.

`apps/web/src/hooks/use-ws-session.ts` — opens `client.events()` async iterator in a reconnect-safe loop; each re-subscribe pulls `client.state()` once to cover init()'s bootstrap publishes. `handleEvent(event)` switch dispatches every `ServerEvent` to the store. `frame.final` always pushes a single frame — chain routing was removed.

### 2e. Server entry
`apps/server/src/server.ts` — Bun.serve with Hono for HTTP and `WsRPCHandler` (from `@orpc/server/bun-ws`) for the `/ws` session surface. Verifies ticket on upgrade, creates the Session in `open`, delegates every `message` to the handler. The handler routes into the session router (`packages/api/src/routers/session.router.ts`) whose procedures call `Session` methods. Outbound event validation is enforced by `eventIterator(ServerEvent)` on the `events` procedure's output schema.

### 2f. Session — the load-bearing ~620-line file
`apps/server/src/session/session.ts` + `apps/server/src/session/voice-controller.ts`. Owns:
- Scene + history, hero image, seed
- ~7 timers / in-flight controllers
- 6 trigger reasons (`pause` / `semantic` / `periodic` / `section` / `commit` / `voice`)
- Song recognition pipeline
- Credit gate
- Drift layering (LLM atmosphere / voice / static pool)
- `EventPublisher` for outbound events (the `events` procedure subscribes to it)
- `getSnapshot()` for the bootstrap pull

`VoiceController` (extracted April 2026): owns the voice buffer, debounce timer, LLM intent dispatch, and the 15 s atmosphere TTL. Session holds it via `this.voice` and reads `getAtmosphere()` + `getLatestVoice()` in `trigger()`.

`trigger()` does: prompt build → credit gate → drift → `streamPreview`. One path for every reason; voice triggers just hit `streamPreview` like everything else (previously branched to a 3-step morph chain).

### 2g. fal-provider
`apps/server/src/generation/fal-provider.ts`
- `streamPreview` — single call, env-overridable models, schnell fallback for flow tier. The only image-generation entry point.

---

## 3. Where it smells (ranked, honest)

### 🟠 1. `Session` is a big object (~687 lines)
18+ instance fields, 5 trigger reasons funnelling into one 256-line `trigger()`. Voice handling is currently inline (earlier `VoiceController` extraction was reverted).

**Lowest-risk remaining extraction**: a `credit-gate` module pulled out of `trigger()`'s top — the debit / refund / free-tier / cooldown logic is half of the method and is the most unit-testable. See §4 for ordered cleanup.

### 🟠 2. Five trigger reasons, four of them indistinguishable downstream
`pause`, `semantic`, `periodic`, `section`, `voice` (commit was removed April 2026). Downstream of `trigger()`, the only branch on `reason` is membership in `USER_INITIATED = ["voice", "semantic", "pause"]` for the credit-denial cooldown. Everything else is logging.

**Suggestion**: split into `kind: "auto" | "user"` for dispatch logic and `source: <the five>` for the trigger-log UI. Wire stays the same (event schema keeps the granular value).

### 🟡 3. Drift layering — API shape outlives runtime usage
`sampleDriftLayered` still accepts `llmDrift` + `latestVoice` parameters, but the only call site (`session.ts:515-520`) passes both as `null` — only `trajectory` + static-pool path is wired. The combinatorics are dead-code; the signature is misleading.

**Suggestion**: drop the unused params, rename to `sampleDrift`. Re-add layers if LLM-drift or voice-drift comes back.

### ✅ 4. ~~The chain step-0 special case~~ — RESOLVED BY DELETION
Morph chain removed April 2026. Every trigger is a single `streamPreview` call now; no `pendingChain`, no `enqueueChainFrame`, no step-0 branch.

### ✅ 5. ~~Two render fallback paths~~ — DONE
CSS fallback `CssFrames` deleted. `dream-canvas.tsx` shrunk 309 → 66 lines. Now WebGL2-only with a "WebGL2 required" overlay. `prefers-reduced-motion` survives downstream via intensity damping.

### ✅ 6. ~~`useChainDrain` runs rAF forever~~ — RESOLVED BY DELETION
Hook file removed; no drain loop remaining.

### ✅ 7. ~~Visualizer store is a junk drawer~~ — RESOLVED VIA SLICES
Split into 6 zustand slices under `apps/web/src/stores/visualizer/`: `scene-slice`, `playback-slice`, `inspector-slice`, `preset-slice`, `ui-slice`, `voice-slice`. The old `stores/visualizer-store.ts` was a back-compat barrel and has been removed.

### 🟡 8. Effects-deck monolith
`displacement-shaders.ts` is one 700-line shader with 30 `if` blocks. Each preset is a config object that flips uniforms. It works, but adding a new effect means: shader edit + uniform binding + `uni` map entry + preset config + audio routing entry.

**Suggestion**: leave it. The monolith is worse than modular shaders only if you're adding effects weekly. The friction is acceptable for what it buys (one shader compile, preset crossfade is just config lerp).

### 🟠 9. `displacement-canvas.tsx` mega-effect
The specific `revealStartAt` / `lastCrossfadeAt` refs are gone (crossfade state moved to a module-level `state` object). But the file grew from ~600 → **902 lines** since this list was first written. One `useEffect` (lines 228 → end-of-file) owns shader build, uniform binding, audio-envelope construction, FBO setup, frame loop, palette reduction, droplet seeding, crossfade, RD-layer wiring.

**Suggestion**: deliberately deferred. The file is on the AGENTS.md don't-touch list — refactoring it is high-risk for marginal ergonomic gain.

### 🟢 10. Many small canvas overlays might overlap with shader effects
`CanvasGrain`, `InkDrops`, `CanvasOscilloscope`, vignette div — and the shader has `uGrain`, `uHalation`, `uVignette`, etc. Possibly historical layering. Worth auditing whether each overlay is still pulling its weight.

---

## 4. Suggested cleanup order

Maximum win per hour. Done items struck through.

1. ~~**Delete the CSS fallback path** (#5)~~ — ✅ done.
2. ~~**Visualizer store split** (#7)~~ — ✅ done via 6-slice composition.
3. ~~**Replace `useChainDrain` rAF**~~ — ✅ resolved by chain deletion.
4. **Extract `credit-gate` from `session.trigger()`** (#1). Pull the debit / refund / free-tier / cooldown half of `trigger()` into `apps/server/src/credits/credit-gate.ts`. Cuts ~50 lines from `session.ts` and makes the cooldown rule unit-testable.
5. **Collapse trigger reasons to `kind: "auto" | "user"`** (#2). Server dispatch logic only; keep `reason` on the wire as `source` for the trigger-log UI.
6. **Prune drift-layering API** (#3). Drop the unused `llmDrift` / `latestVoice` params from `sampleDriftLayered`; rename to `sampleDrift`.
7. **Audit canvas overlays vs shader effects** (#10). Mostly reading; deletes if any overlay is redundant with shader uniforms.

**Skip** the shader monolith refactor (#8), the `displacement-canvas.tsx` mega-effect (#9), and further `Session` extraction beyond credit-gate — high risk, low ergonomic win.
