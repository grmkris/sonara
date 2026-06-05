# oxlint-disable review checklist

These are the **54 inline `oxlint-disable` comments** left behind when sonara adopted the ultracite `core+next` oxlint preset and ground all preset errors to zero (commits `846768f` + `1c1d702`). Each one is tagged in-code with a `REVIEW:` marker so you can find them:

```bash
grep -rn "oxlint-disable.*REVIEW:" apps packages --include="*.ts" --include="*.tsx"
```

Walk the table below and decide each: **keep** (the rule genuinely doesn't fit), **rewrite** (make the code pass and delete the disable), or **turn the rule off centrally** in `oxlint.config.ts` if it recurs and you'd rather not see it inline. Nothing here has been rewritten or config-changed yet — this pass only marks + indexes.

Legend for **Disposition**: 🔴 impossible to satisfy · 🟡 intentional design choice · 🟠 fire-and-forget / hot path · 🟢 easily rewritable (safe to remove the disable).

---

## 🟢 Easily rewritable — recommend dropping the disable (3)

| File:line | Rule | Reason | Suggested rewrite |
|---|---|---|---|
| `apps/web/src/app/login/page.tsx:84` | `catch-error-name` | `error` would shadow outer state | rename the caught var (e.g. `err`) — already done; just delete the disable |
| `apps/web/src/lib/session-actions.ts:31` | `default-case` | exhaustive over `SessionAction` union | add `default: { const _x: never = action; return _x; }` (satisfies the rule **and** keeps TS exhaustiveness) |
| `apps/web/src/components/visualizer/canvas/ghost-overlay.tsx:45` | `no-use-before-define` | `fire`/`scheduleNext` mutually recursive | reorder so `fire` is declared before `scheduleNext` |

## 🔴 Impossible to satisfy by rewriting — keep (4)

| File:line | Rule | Why it can't be rewritten |
|---|---|---|
| `packages/shared/src/ws-ticket.ts:91` | `no-bitwise`, `unicorn/prefer-code-point` | constant-time compare **requires** bitwise `^`/`\|`; rewriting reintroduces a timing-oracle leak |
| `apps/server/scripts/gen-deck-offline.ts:118` | `no-bitwise` | `& 0x7fffffff` masks to a 31-bit positive seed |
| `apps/server/scripts/seed-library.ts:117` | `no-bitwise` | same seed mask |
| `apps/web/src/components/sw-register.tsx:24` | `unicorn/require-post-message-target-origin` | `ServiceWorker.postMessage` has **no** `targetOrigin` parameter (that's `window.postMessage` only) |
| `packages/shared/src/ws-ticket.ts:44` | `unicorn/prefer-code-point` | byte-level decode of a binary string — `charCodeAt` (always-defined UTF-16 unit) is the correct primitive; `codePointAt` returns `number\|undefined` |

## 🟡 Intentional design choice — keep unless you want the rule globally off (24)

| File:line | Rule | Reason |
|---|---|---|
| `packages/api/src/index.ts:1` | `no-barrel-file` | package public entrypoint — re-exports are the API surface |
| `packages/shared/src/index.ts:1` | `no-barrel-file` | intentional public barrel for `@sonara/shared` |
| `packages/db/src/schema/index.ts:8` | `no-barrel-file` | public schema surface for `@sonara/db/schema` |
| `apps/server/src/env.ts:7` | `sort-keys` (block) | env keys grouped required-vs-optional with doc comments |
| `apps/web/src/lib/render/presets.ts:137` | `sort-keys` (**block** `// oxlint-disable`, no `enable`) | curated preset ordering (baseline→distinct) |
| `apps/web/src/components/visualizer/canvas/displacement-canvas.tsx:283` | `sort-keys` | uniform-location map grouped by render concern |
| `packages/db/src/schema/image-library.db.ts:44` | `sort-keys` | columns grouped by concern; key order has no SQL effect |
| `apps/web/src/stores/visualizer/preset-slice.ts:61` | `no-dynamic-delete` | `delete` on a JSON-persisted record keyed by user preset names |
| `apps/web/src/hooks/use-ws-session.ts:160` | `no-unmodified-loop-condition` | `cancelled` flipped by the effect cleanup closure (linter can't see it) |
| `apps/web/src/components/visualizer/controls/preset-picker.tsx:155` | `no-alert` | native `confirm` is the intended lightweight delete guard |
| `apps/web/src/components/visualizer/controls/preset-picker.tsx:177` | `no-alert` | native `prompt` is the intended lightweight name capture |
| `apps/server/src/generation/prompt-compiler.ts:23` | `complexity` | straight-line prompt assembly; FLUX.2 slot order |
| `apps/web/src/components/visualizer/canvas/displacement-canvas.tsx:623` | `complexity` | per-frame render loop; splitting adds per-frame overhead |
| `apps/web/src/hooks/use-ws-session.ts:32` | `complexity` | flat per-event-type dispatch switch |
| `apps/web/src/lib/audio/analyzer.ts:581` | `complexity` | single per-frame DSP pipeline at 60 Hz |
| `apps/web/src/components/visualizer/canvas/displacement-canvas.tsx:409,411,420,438,478,499,992,994` | `unicorn/prefer-add-event-listener` (×8) | `.onload/.onerror` assignment paired with `=null` detach; assignment semantics intentional |
| `apps/web/src/lib/recording/video-recorder.ts:106` | `unicorn/prefer-add-event-listener` | one-shot MediaRecorder `onstop/onerror` assignment |
| `apps/web/src/hooks/use-voice-recognition.ts:112` | `prefer-add-event-listener` | `SpeechRecognitionLike` exposes only `on*` props, no `addEventListener` |

## 🟠 Fire-and-forget / hot path — keep to preserve non-blocking semantics (23)

Rewritable to `void (async () => { try { await … } catch {} })()` (background) or an `async` handler (event callbacks) **if** you later want these rules enforced — but each re-touches a live/critical path (payments, WS session, 60 Hz audio), so review individually.

| File:line | Rule(s) | Reason |
|---|---|---|
| `apps/server/src/session/session.ts:936` | `promise/prefer-await-to-then`, `-callbacks` | `streamPreview` must stream in background; awaiting blocks `trigger()` hot path |
| `apps/server/src/session/session.ts:1222` | `promise/prefer-await-to-then`, `-callbacks` | `streamAnchor` background stream; same |
| `apps/server/src/credits/credit-gate.ts:124` | `prefer-await-to-then`, `-callbacks` | fire-and-forget refund in a sync void helper |
| `apps/server/src/generation/scene-resolver.ts:72` | `prefer-await-to-then`, `-callbacks` (**block**) | background fill must stay a non-awaited chain |
| `apps/server/src/generation/scene-resolver.ts:135` | `prefer-await-to-then` (**block**) | promise shared via `inFlight` before awaiting (dedupe) |
| `apps/web/src/hooks/use-remote-session.ts:111` | `prefer-await-to-then`, `-callbacks` | `SessionSend` is sync fire-and-forget |
| `apps/web/src/hooks/use-ws-session.ts:134` | `prefer-await-to-then`, `-callbacks` | `SessionSend` sync fire-and-forget |
| `apps/web/src/hooks/use-ws-session.ts:195` | `prefer-await-to-then` | bootstrap fire-and-forget; awaiting blocks the loop |
| `apps/web/src/lib/audio/analyzer.ts:351` | `prefer-await-to-callbacks` | event-style registration (source-lost notification) |
| `apps/web/src/lib/audio/analyzer.ts:399` | `prefer-await-to-callbacks` | per-frame tick subscription (~60 Hz) |
| `apps/web/src/lib/audio/analyzer.ts:468` | `prefer-await-to-then` | `stop()` is sync; closing context is fire-and-forget |
| `apps/web/src/components/visualizer/controls/fullscreen-toggle.tsx:22` | `prefer-await-to-then` | fire-and-forget in sync callback |
| `apps/web/src/components/visualizer/controls/fullscreen-toggle.tsx:27` | `prefer-await-to-then` | fire-and-forget in sync callback |
| `apps/web/src/components/visualizer/controls/music-source.tsx:166` | `prefer-await-to-then` | `el.play()` rejection; `setSource` runs unconditionally |
| `apps/web/src/components/visualizer/controls/record-toggle.tsx:58` | `prefer-await-to-then` | sync effect cleanup; fire-and-forget stop |
| `apps/web/src/hooks/use-ws-session.ts:218` | `avoid-new` | `new Promise` wrapping `setTimeout` delay — no library equivalent |
| `apps/web/src/lib/recording/video-recorder.ts:99` | `avoid-new` | `new Promise` bridging MediaRecorder events |
| `apps/web/src/lib/audio/recorder.ts:114` | `promise/avoid-new` | `new Promise` wrapping `setTimeout` delay |
| `apps/server/src/library/example-sessions.ts:67` | `require-await` | returns a drizzle thenable; `async` keeps declared `Promise<SeedRow[]>` |
| `apps/web/src/hooks/use-ws-session.ts:120` | `require-await` | `async` signature kept; awaits live in the inner spawned loop |
| `apps/web/src/lib/audio/analyzer.ts:417` | `require-await` | `async` keeps the return type a Promise on both paths |

> **Block-scope note:** `presets.ts:137`, `scene-resolver.ts:72`, and `scene-resolver.ts:135` use **block** `oxlint-disable` (not `-next-line`) with no matching `oxlint-enable`, so they suppress the rule for the rest of the file. If you keep them, consider scoping with a matching `// oxlint-enable …` or converting to `-next-line`.
