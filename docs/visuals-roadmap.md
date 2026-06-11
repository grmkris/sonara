# Sonara visuals roadmap — research-grounded improvement plan

Derived from a deep field study of the audiovisual-performance / VJ / realtime-AI-visuals
industry, cross-referenced against sonara's actual code. This file is the plan of record
for improving the visual engine. Items are grouped by horizon and tagged with current
code state so changes start from ground truth, not assumptions.

## What sonara is (industry framing)

A **real-time audio-reactive AI visual engine in the browser** — in industry terms, a
first-generation **AI VJ engine**. Pipeline: live audio → 60 Hz browser feature extraction
→ LLM scene expansion → realtime diffusion keyframes (FAL FLUX / SDXL-Lightning / LCM) →
WebGL2 fragment-shader crossfade with audio reactivity, plus a Monad on-chain "stage"
(crowd nudges knobs / queues prompts) and replayable "reels".

Where it sits: the empty quadrant nobody else occupies — **realtime-AI + live-audio-reactive
+ zero-install browser + crowd/on-chain interactive**. Competitors miss at least one column:
Krea (no audio/crowd), TouchDesigner+StreamDiffusion (desktop+GPU, no product), Kaiber /
Neural Frames (offline render), butterchurn/Synesthesia (reactive but not AI),
EulerBeats/Async (on-chain but static).

## The throughline insight

**Sonara measures the beat but never dances on it.** The analyzer does serious beat work —
autocorrelation BPM with a stability bonus (`apps/web/src/lib/audio/analyzer.ts:80`), a
continuous `bpmPhase` ramp (`analyzer.ts:730`), onset detection (`analyzer.ts:694`) — but:

- **`bpmPhase` / `bpm` are consumed in zero places in the visual layer.** A grep across
  `components/visualizer`, `lib/render`, and `stores` returns nothing. The clock is computed
  every frame, shipped over the wire, then ignored by the shader. Visuals are purely
  envelope-follower reactive (RMS→bloom, bass→warp, onset→ink dab) — they pulse *near*
  energy, never *locked* to the grid.
- **Generation cadence is pure wall-clock**, not beat-aware: `cadenceFromIntensity` →
  `periodicMs` 8–16s + a 12s section refractory (`apps/server/src/session/session.ts:99,123`).
  Keyframes land whenever the timer fires, never on a downbeat.

So the most-recommended differentiator (**beat-synced generation**) and the cheapest visual
win (**beat-locked accents**) are blocked by the same gap: nothing consumes the clock we
already built. That gap is the spine of this roadmap.

---

## Short-term (hours → ~2 days, isolated, low risk)

| # | Change | Current code | Why | Effort/Impact |
|---|---|---|---|---|
| S1 | **Wire `bpmPhase` → a `uBeatPhase` uniform + a tasteful on-beat accent** (zoom kick, halation flash, RD seed) | `bpmPhase` computed at `analyzer.ts:730`, unused in shader (`displacement-shaders.ts` has `uBass/uRms/uSnare`, no beat phase) | We already pay for it. Turns "pulses near energy" into "moves on the grid" | XS / very high |
| S2 | **PLL-lock the phase to onsets** — nudge `bpmPhase` toward 0 on a confident onset instead of free-running | `bpmPhase` advances open-loop from `bpmEst` only (`analyzer.ts:730-733`); drifts vs. real downbeats | Makes S1 land *on* the beat instead of sliding off. ~15 lines | XS / high |
| S3 | **Per-feature running auto-gain** (running max w/ decay → normalize bass/mids/treble/flux) | Bands are raw `mean(freq)/255` (`analyzer.ts:657-659`); only a global `DynamicsCompressor` (`analyzer.ts:500`) | Fixes "dead treble next to dominant bass" + robustness across loud/quiet tracks — the most-skipped pro technique | S / high |
| S4 | **Median (not mean) adaptive onset threshold** | `flux > fluxMean + 1.5σ` (`analyzer.ts:690-695`) | Mean is dragged up by the very peaks you detect; median is what madmom/Böck use | XS / med |
| S5 | **K/A-weight before RMS** (one-pole high-shelf + high-pass, or drop sub-20Hz/DC) | RMS over raw time-domain (`analyzer.ts:602-607`) | Perceptual loudness so sub-bass stops dominating `bloom`/`motionEnergy` | S / med |

S1+S2 together are the headline short-term move (~half-day) and visible the moment a track plays.

---

## Mid-term (~1–3 weeks, crosses layers, real design)

| # | Change | Current code | Why |
|---|---|---|---|
| M1 | **Beat-synced generation scheduling** — client predicts next downbeat from `bpm`+`bpmPhase`, fires `trigger()` ~(gen-latency) ahead so the keyframe reveals on the beat | Trigger timing is wall-clock only (`cadenceFromIntensity`, `session.ts:123`; `schedulePause`, `session.ts:675`) | The #1 uncopied differentiator. At 128 BPM a beat ≈ 470ms; FAL realtime is 150–300ms — fire one beat ahead and the frame lands on the downbeat. Needs client→server "fire-at" hint or client-driven trigger gate |
| M2 | **Multi-band onset/flux** (kick=low, snare=mid, hat=high) instead of full-spectrum flux + post-hoc classify | Single full-spectrum flux (`analyzer.ts:662-673`) then `classifyOnset()` infers type from band ratios | Separates drum hits at the source; makes per-onset channel-split / ink-dab routing far more accurate |
| M3 | **Reveal/crossfade timing snaps to the beat grid** | Crossfade is a fixed `PRESET_CROSSFADE_MS` ease (displacement-canvas) | Transitions that resolve on the bar read as "composed," not random |
| M4 | **Frequency → screen-region mapping** (bass→center/large warp, treble→edges/grain spatially) | Bands map to noise *octaves* (`swellAmp`/`midAmp`/`fineAmp`, `displacement-shaders.ts:250-252`) — multi-scale but still global | Kills residual "whole frame throbs as one blob"; gives the image musical structure. Partway there already |
| M5 | **Evaluate Essentia.js** for tempo/downbeat/key vs. hand-rolled DSP | KK key (`analyzer.ts:128`) + autocorr BPM (`analyzer.ts:80`) are solid but classical | `RhythmExtractor2013`/EBU-R128 loudness are production-grade if you outgrow current quality; weigh against WASM bundle cost |

M1 is the fight-for item — the audio-reactivity capability the entire keyframe-tool category
(Kaiber, Neural Frames, even StreamDiffusionTD) structurally lacks.

---

## Long-term (weeks → months, architectural / strategic)

1. **Pick the moat and defend it — generation is commoditizing.** FAL/Krea/Daydream are
   racing frame cost to zero. Defensible territory: **(a) beat-synced generation (M1)** and
   **(b) the Monad stage + reels as a social/multiplayer layer** — not chasing frame rate.
2. **Reels → a network-effect layer, not just replay.** No realtime competitor has shareable,
   curated, replayable artifacts. Build discovery/remix/leaderboards on `reel` + `image_library`.
3. **Pro-ecosystem on-ramp (optional, big TAM):** **Ableton Link** (ride a real DJ's clock)
   + **NDI/Syphon output** (sonara's canvas as a source inside Resolume/MadMapper). Exactly
   how StreamDiffusion/Daydream entered the scene; converts "toy in a tab" → "source in the rig".
4. **Renderer ceiling:** **GPU particles** (WebGL2 transform-feedback now → WebGPU compute
   later; curl-noise advected, onset-emitted) and **SDF raymarching** for true 3-D scenes.
   Big lift; only after the moats are cemented.
5. **Continuous-video frontier (watch, don't chase):** StreamDiffusionV2 / self-hosted
   streaming diffusion gives generated motion vs. shader-interpolated keyframes — higher
   fidelity, far higher cost/latency. Keyframe-crossfade is the right call for a web product
   today; revisit only if hosted streaming-video infra gets cheap.

---

## Do NOT touch (already better than most)

Asymmetric attack/release VU envelopes (`map-audio-to-visuals.ts:18-32`), KK key detection
with latching (`analyzer.ts:646`), BPM stability bonus (`analyzer.ts:104`), frequency→noise-octave
mapping (`displacement-shaders.ts:250`), and the curated post chain (especially the anisotropic
Kuwahara). Genuinely sophisticated — leave them alone.

---

## Suggested sequence

S1 + S2 (beat-locked visuals, half-day, immediately visible) → S3 + S4 (robustness, ~1 day)
→ S5 → M1 (beat-synced generation, the flagship) → then choose between the **pro on-ramp**
(Link/NDI) and the **renderer ceiling** (particles/SDF) based on whether the target is VJs
or consumers.

## Key terminology (so we speak the field's language)

- Discipline: **VJing** (club), **live visuals / AV performance** (pro/festival), **visual
  music** (art-historical), **creative coding / demoscene** (the shader craft).
- Our **scene** = industry **scene/column** or **composition**; **preset/crossfade/deck** are
  exact; **audio-reactive**, **feedback**, **reaction-diffusion**, **bloom** are all standard.
- Our **reels** = **VJ loops / content reel**; ordered set = **playlist / setlist**.
- Genuinely novel (no industry term): **valence/arousal "mood" mapping** and **crowd-controlled
  parameters over blockchain** — lean into both as differentiators.
- Interop vocabulary worth knowing for the long-term on-ramp: **Spout/Syphon/NDI** (texture
  sharing), **Ableton Link** (tempo sync), **DMX/Art-Net** (lighting), **MIDI/OSC** (control).
