# Architecture & Cleanup Notes

A code tour for refactoring decisions. Read top-down: data flow first, then a layer-by-layer map with file paths, then an honest list of where complexity has accumulated and what to do about it.

> **Status at last update:**
> - ✅ CSS fallback renderer deleted (was smell #5).
> - ✅ Papari–Kuwahara painterly post-pass landed (new `uPainterly` uniform + preset field).
> - ✅ Three new ink primitives landed (`uSalt`, `uCauliflower`, `uSplatter` — all original code, license-safe).
> - ✅ `ClientEvent` → oRPC migration complete (new `@music-visualizer/api` package; `SessionSend` + `dispatchSessionAction` in `apps/web/src/lib/session-actions.ts`). Typecheck clean across all 5 packages.
> - ✅ `VoiceController` extracted from `session.ts` (761 → 618 lines; smell #1 partial).
> - ✅ `session.state()` bootstrap-pull procedure covers the `EventPublisher` race where `init()` publishes land before the client's `events()` subscribe attaches.
> - ❌ Lygia refactor dropped (Prosperity + Patron license incompatible with proprietary project).
> - ✅ Morph chain removed (April 2026) — unified single-frame `streamPreview` path for every trigger. Reveal shader stays.
> - **Tier 1 + Tier 2 closed.** Remaining work is the deferred smell-list items from §4.

See `REFACTOR-PLAN.md` for the tiered action list and progress.

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

### 🟠 1. `Session` is still a big object (~620 lines post-voice-extraction)
~16 instance fields, 6 trigger reasons that all funnel into one 150-line `trigger()`. Voice is out; triggers and recognition orchestration remain.

**Suggestion** (remaining): extract two more modules:
- `session/triggers.ts` — pause/periodic/semantic scheduling, trigger() body
- `session/recognition.ts` — song-id dedupe + merge call (recognize method body; cache/enrichment already in `recognition/`)

~~`session/voice.ts` — done April 2026.~~

Session itself becomes the orchestrator (state + send) only.

### 🟠 2. Six trigger reasons, four of them indistinguishable downstream
`pause`, `semantic`, `periodic`, `section` differ in *when* they fire but produce identical work in `trigger()`. The reason is only used for logging and the credit-denial cooldown rule.

**Suggestion**: collapse to two — `auto` (any timer/audio-driven) and `user` (commit/voice). Keep the trigger source as a separate field for the trigger-log UI.

### 🟠 3. Drift layering is a 3-deep stack
`currentAtmosphere` (LLM) → `latestVoice` (raw) → `sampleDriftLayered` (static pool) — with a TTL on each layer. The combinatorics make it hard to reason about which clause ends up in the prompt at any given moment.

**Suggestion**: pick one source per trigger by simple priority and emit it. Don't blend.

### ✅ 4. ~~The chain step-0 special case~~ — RESOLVED BY DELETION
Morph chain removed April 2026. Every trigger is a single `streamPreview` call now; no `pendingChain`, no `enqueueChainFrame`, no step-0 branch.

### ✅ 5. ~~Two render fallback paths~~ — DONE
CSS fallback `CssFrames` deleted. `dream-canvas.tsx` shrunk 309 → 66 lines. Now WebGL2-only with a "WebGL2 required" overlay. `prefers-reduced-motion` survives downstream via intensity damping.

### ✅ 6. ~~`useChainDrain` runs rAF forever~~ — RESOLVED BY DELETION
Hook file removed; no drain loop remaining.

### 🟡 7. Visualizer store is a junk drawer
25+ fields, 6 different concerns. Field names start to collide (`commitPulse`, `sweepPulse`, `presetTick`, `identifyTick` are all "monotonic event triggers").

**Suggestion**: split into 3 stores — `useFrameStore` (render output), `useSessionStore` (server-mirrored state), `useUIStore` (local UI). Or namespace within one store: `s.frames.current` instead of `s.currentFrame`. Existing components would need import updates but it's mechanical.

### 🟡 8. Effects-deck monolith
`displacement-shaders.ts` is one 700-line shader with 30 `if` blocks. Each preset is a config object that flips uniforms. It works, but adding a new effect means: shader edit + uniform binding + `uni` map entry + preset config + audio routing entry.

**Suggestion**: leave it. The monolith is worse than modular shaders only if you're adding effects weekly. The friction is acceptable for what it buys (one shader compile, preset crossfade is just config lerp).

### 🟢 9. Reveal-pass state lives inside a 600-line useEffect
`revealStartAt`, `lastCrossfadeAt` are local mutable refs in the canvas effect. Works but adds to the cognitive load of an already-huge effect body.

**Suggestion**: extract to a tiny `reveal-controller.ts`:
```ts
export function createRevealController(): {
  armOn(crossfadeAt: number | null): void;
  sample(now: number, impulses: {kick: number; snare: number}): {active: number; t: number};
}
```
Same closure pattern, but at the top of the file with a clear API.

### 🟢 10. Many small canvas overlays might overlap with shader effects
`CanvasGrain`, `InkDrops`, `CanvasOscilloscope`, vignette div — and the shader has `uGrain`, `uHalation`, `uVignette`, etc. Possibly historical layering. Worth auditing whether each overlay is still pulling its weight.

---

## 4. Suggested cleanup order

Maximum win per hour. Done items struck through.

1. ~~**Delete the CSS fallback path** (#5)~~ — ✅ done.
2. ~~**Extract `voice.ts` from `session.ts`** (#1)~~ — ✅ done. Now at `apps/server/src/session/voice-controller.ts`. Session ~620 lines. Two more modules to extract (`triggers.ts`, `recognition.ts`) if we want to finish #1.
3. **Collapse trigger reasons to `auto`/`user`** (#2). Touches event schema and trigger-log UI but mostly find/replace. ~1 hr.
4. ~~**Replace `useChainDrain` rAF**~~ — ✅ resolved by chain deletion.
5. **Audit overlays vs shader effects** (#10). Mostly reading; deletes if anything is redundant. ~1 hr.

**Skip** the shader monolith refactor (#8) and store split (#7) unless you're adding new features that pay for the move.
