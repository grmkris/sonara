# Gesture & Camera Input — playing the visuals like an instrument

> Status: **research / future**. Captured for later. Sequenced *after* the Mood Field core
> (`docs/mood-field-plan.md`). No code yet.

## Context

Today the visuals are driven only by audio + the preset/scene controls. We want users to
**control visuals and effects directly** — moving the mouse/trackpad to drive effects, and
eventually using the **camera to track hands/motion**. This is especially compelling for live
use (techno events).

## The unifying idea (why this isn't a pile of gimmicks)

Sonara already exposes two "slots" that *any* input can plug into. Every modality below reduces
to one of two verbs:

1. **Navigate** — move the **Mood Field dot** (the XY position from `docs/mood-field-plan.md`).
   Slow, deliberate input changes *the look*.
2. **Perform** — inject into the **per-frame energy/impulse bus** that `displacement-canvas.tsx`
   already computes from audio (`targetsFromAudio` → `motionEnergy`/`warp`/`zoom` in
   `apps/web/src/lib/render/map-audio-to-visuals.ts`, plus kick/snare `impulses` in the tick
   loop). Fast, twitchy input adds momentary turbulence / zoom punches / glitch.

So the implementation is mostly: **add an "input contributor" alongside audio** in the existing
60fps tick, and (for navigation) call the Mood Field's `setMoodPos`. We are not building a new
rendering path.

## Current input plumbing (what exists)

- Mic capture via `getUserMedia({ audio: true, video: false })` in `apps/web/src/lib/audio/analyzer.ts`.
  **No camera/video input today.** No MediaPipe / TensorFlow deps in `apps/web/package.json`.
- Pointer handling only on controls (`slider-row.tsx`, `intensity-dial.tsx`) and UI reveal
  (`play/page.tsx`). The full-screen visualizer canvas has **no pointer/gesture handlers yet**.
- `canvas.captureStream` is used for *recording* (`video-recorder.ts`) — unrelated, but confirms
  the canvas is addressable.

---

## Tier 0 — Pointer & trackpad (ship first; zero deps, ~no perf cost)

Attach handlers to the visualizer canvas. Highest value-to-effort; works on the live laptop with
no framerate risk; reuses the Mood Field XY.

- **Cursor position → nudge the dot** (perform layer over the mood field).
- **Cursor velocity → turbulence/impulse** — fast swipes throw ink, slow drifts settle. Feeds the
  existing `motionEnergy` / `warp` targets.
- **Trackpad pinch → zoom**: `wheel` event with `e.ctrlKey === true` (Chrome/Edge); Safari
  `gesturechange` `e.scale`.
- **Two-finger rotate → hue / field rotation**: Safari-only `gesturestart/gesturechange/gestureend`
  `e.rotation` (WebKit non-standard). Degrade gracefully elsewhere.
- **Pointer Lock "perform mode"**: click canvas → `requestPointerLock()`, cursor hides, raw
  unbounded `movementX/movementY` drive visuals like a Kaoss pad; Esc exits. ~30 lines. Solves the
  "engage/disengage" problem cleanly (Midas-touch: input only active while locked).

Notes: Pointer Lock is **desktop only** (no mobile). `pointerrawupdate` (Chrome/Firefox) gives
sub-frame latency if needed — use cautiously. Use `getCoalescedEvents()` for smooth velocity.

## Tier 0.5 — Hardware controllers (cheap, very reliable for real VJs)

- **Web MIDI API** (`navigator.requestMIDIAccess`) — map MIDI faders / Kaoss pad / Launchpad to
  Mood Field XY + effect params. ~1–10ms latency, rock solid. **Chromium-only** (no Firefox/Safari).
- **Gamepad API** — analog sticks → XY, triggers → intensity. All browsers, polling model.
- For a live performer, a $50 MIDI controller is more dependable than a webcam. Worth offering.

## Tier 1 — Webcam *motion* (no ML) — the sleeper hit

Downscale the webcam to ~64×48 and do frame-differencing / optical flow (GPU). **~3–5ms**, robust
in club lighting (no skeleton to lose), one camera permission.

- **Motion energy → turbulence / bloom** ("wave your hand, the ink reacts").
- **Motion centroid → moves the dot** (where you wave = where the mood goes).
- Gets ~80% of the "magic" of hand tracking for ~10% of the cost/risk.
- Refs: [glsl-optical-flow](https://github.com/keeffEoghan/glsl-optical-flow),
  [codersblock motion detection](https://codersblock.com/blog/motion-detection-with-javascript/).

## Tier 2 — MediaPipe hand tracking (big effort, real perf cost) — opt-in "studio" toy

`@mediapipe/tasks-vision` `HandLandmarker` (21 landmarks/hand, actively maintained), run in a
**Web Worker + OffscreenCanvas**; post lightweight landmark floats back to the main thread.

- **Pinch** (thumb–index distance) → grab/trigger · **two-hand spread** → zoom · **palm height** →
  intensity · **hand XY** → the dot · **palm rotation** → hue.
- This is the expressive ceiling (Theremin / Imogen Heap MiMU territory) **but the riskiest**: a
  *second* GPU workload (~12–17ms/inference) on top of an already-heavy 60fps shader + FFT. On the
  **live-event laptop that's exactly where frames drop** — gate behind an explicit toggle, never on
  by default at a show. Optional add-on: [Fingerpose](https://github.com/andypotato/fingerpose) for
  finger-curl gesture classification on the landmarks.
- Live examples: [Semi-Conductor](https://experiments.withgoogle.com/semi-conductor),
  [collidingScopes/arpeggiator](https://github.com/collidingScopes/arpeggiator).

---

## Non-negotiable rules (these make-or-break gesture features)

- **One-euro filter on every input stream** ([casiez/OneEuroFilter](https://github.com/casiez/OneEuroFilter)):
  strong smoothing when slow, low lag when fast. Mandatory for camera/hand input jitter.
- **Explicit engage/disengage** (Pointer Lock, a toggle, or a deliberate gesture) to avoid the
  Midas-touch problem where every idle movement hijacks the visuals.
- **Spatial coherence**: move right → effect moves right. Keep mappings literal.
- **Latency budget < ~50ms** end-to-end to feel tight; do everything **locally** (no server round-trip).
- **Dead zones** around neutral to suppress tremor; **confidence thresholds** to reject bad poses.
- Beware **gorilla-arm fatigue**, **club lighting**, and **occlusion** — all argue for the coarse
  motion-flow (Tier 1) over fine hand-tracking (Tier 2) in live settings.

## Recommended rollout

**Tier 0 (pointer/trackpad) → Tier 0.5 (MIDI, if a VJ asks) → Tier 1 (webcam motion) → Tier 2
(hand tracking, opt-in studio mode).** Tiers 0–1 are low-risk, high-delight, and ride on top of the
Mood Field cleanly. Treat Tier 2 as a toy, not the live default.

## Where it touches the code (when we build it)
- New input module(s) under `apps/web/src/lib/input/` (pointer, motion, hands).
- A small "input contributor" merged into the `displacement-canvas.tsx` tick alongside audio
  targets/impulses, plus calls to the Mood Field `setMoodPos`.
- Camera: a second `getUserMedia({ video: ... })` (separate from the mic stream in `analyzer.ts`),
  behind an opt-in toggle with a clear permission rationale.
