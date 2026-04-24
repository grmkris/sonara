# Refactor Plan

Follow-up to `ARCHITECTURE.md`. This is an action list informed by three parallel Opus 4.7 research agents (WebGL/VJ libs, diffusion/fluid/reveal prior art, watercolour/audio-mapping prior art). Delete this file when the list is executed.

## Progress

| Step | Status | Notes |
|---|---|---|
| Tier 1 #1 — Delete CSS fallback | ✅ done | `dream-canvas.tsx` 309 → 66 lines; WebGL2 overlay added |
| Tier 2 #2 — Papari–Kuwahara pass | ✅ done | new `uPainterly` uniform; 4 presets tuned (wet_ink 0.35, bone_china 0.45, worn_linen 0.35, long_exposure 0.4) |
| Tier 2 #3 — Salt / cauliflower / splatter | ✅ done | 3 new uniforms `uSalt`/`uCauliflower`/`uSplatter`; tuned on wet_ink, bone_china, tide_pool, paper_rain, storm |
| Tier 3 #4 — lygia include refactor | ❌ dropped | Prosperity + Patron license incompatible with proprietary project; monolithic shader stays |
| Tier 3 #5 — Fluid-sim preset | 💤 deferred | additive, not cleanup |

**Related completed work:** `ClientEvent` → oRPC migration (new `@music-visualizer/api` package + `SessionSend` bridge in `apps/web/src/lib/session-actions.ts`). Typecheck clean across all 5 packages.

---

## Execution plan: Tier 1 + Tier 2 (license-resolved)

### License audit
Project is `private: true` with no LICENSE file = proprietary. Only permissive (MIT/Apache/BSD/Zlib/ISC) or original code is safe.

| Source | License | Decision |
|---|---|---|
| Custom code (Tier 1 #1: CSS delete) | n/a | ✅ proceed |
| Maxime Heckel's blog (Tier 2 #2: Kuwahara) | **No explicit license** | ❌ cannot copy code · ✅ re-implement from published algorithm (Kuwahara 1976; Papari et al. 2007 — algorithms aren't copyrightable) |
| JRMeyer/ghostty-watercolors (Tier 2 #3: ink primitives) | **No LICENSE file** | ❌ cannot copy code · ✅ re-implement watercolour techniques from common knowledge (salt, cauliflower-backruns, splatter are traditional techniques, not novel inventions) |
| Reference: TxN/UnityURP_Kuwahara | MIT | ✅ may consult for algorithm shape; HLSL not directly portable |

**Net:** all three Tier 1+2 items are safe to execute. We write original GLSL based on published algorithms and folk-traditional techniques. Cite the algorithm source in code comments, never the specific implementation we read.

---

### Step 1 — Delete CSS fallback renderer ✅ DONE

**Final change:** `dream-canvas.tsx` 309 → 66 lines. Deleted `CssFrames`, `FrameLayer`, `EnvelopeBundle`, `buildEnvelopes`, `prefersReducedMotion`, `BLEED_MS`/`FADE_MS`. Added `Webgl2RequiredOverlay` shown only when `isWebgl2Available()` returns false (SSR-safe: `null` initial renders the normal tree). Typecheck clean.

---

### Step 2 — Papari–Kuwahara painterly post-pass ✅ DONE

**Final change:** Added `uPainterly` uniform and a ~50-line Kuwahara block in `displacement-shaders.ts` after the halation pass (24 ring samples across 3 radii × 8 sectors + centre anchor → picks lowest-luma-variance sector's mean → mixes into `color`). Wired in `displacement-canvas.tsx` (uni map + per-frame push from `effective.painterly`). Added `painterly` field to `PresetConfig`, `BASE`, and `lerpPreset`. Tuned: `wet_ink: 0.35`, `bone_china: 0.45`, `worn_linen: 0.35`, `long_exposure: 0.4`. Cited Papari–Petkov–Campisi 2007 in the code comment.

---

### Step 3 — Three new ink primitives: salt, cauliflower, splatter ✅ DONE

**Final change:**
- Shader: added `uSalt`, `uCauliflower`, `uSplatter` uniforms; three gated blocks each ~15 lines.
  - **Cauliflower** placed after bokashi (wet-paint zone), reuses existing `warpedFbm` for fractal ring edges, mid-tone gated.
  - **Salt** placed after granulation (pigment-texture zone), cell-hash point field with bright centre + dark halo, mid-tone gated.
  - **Splatter** placed after grain (surface-texture zone), cell-hash point field with varied-radius dark disks, no luminance gate.
- Canvas wiring: three uni entries + three per-frame pushes.
- Presets: `PresetConfig` fields + `BASE` defaults + `lerpPreset` entries. Tuned: `wet_ink` salt 0.3 · `bone_china` salt 0.25 · `tide_pool` cauliflower 0.45 · `paper_rain` splatter 0.3 · `storm` splatter 0.35.
- All algorithms implemented from first principles (folk watercolour techniques), license-safe.

---

### Order & timing
1. **Step 1 first** — pure deletion, lowest risk, gives a clean baseline before adding shader code.
2. **Step 2 next** — Kuwahara is the single biggest perceptual upgrade.
3. **Step 3 last** — additive primitives, low risk, but only meaningful after presets are visibly settled.

Total: ~5 hr of focused work. Each step is independently shippable; stop anywhere.

---

## Research synthesis (honest)

**Headline finding:** the custom WebGL2 shader and renderer are load-bearing and good. Three independent agents converged on "don't replace wholesale, make surgical upgrades." Two agent recommendations were false positives I caught by reading the code:

- ❌ "Upgrade domain-warp to 2-level iq recursion" — we're already at 2-level. `warpedFbm(p, k)` in `displacement-shaders.ts:166-175` does `fbm(p + k·fbm(p + k·fbm(p)))`.
- ❌ "Trial Meyda instead of hand-rolled analyser" — we already use Meyda at `analyzer.ts:4`. The hand-rolled RMS/centroid are fallback safety.

**Wrong directions flagged by agents (do not pursue):**
- ISF adoption — corpus is neon/geometric VJ, wrong aesthetic; only renderer is WebGL1 and lightly maintained.
- R3F + `@react-three/postprocessing` — adopting Three.js for postprocessing alone is not worth the render-loop rewrite.
- `hydra-synth` — AGPL, aesthetic replacement not augmentation.
- `regl` — boilerplate isn't the pain point; shader is.
- Essentia.js — AGPL dealbreaker.

---

## Action list (prioritised)

### Tier 1 — confirmed, do first

#### 1. Delete CSS fallback renderer · ~30 min
**Files:** `apps/web/src/components/visualizer/dream-canvas.tsx` (~150 lines of `CssFrames` + `FrameLayer`), related `prefers-reduced-motion` detection.

**Approach:**
- Remove the `mode` state and `CssFrames` branch from `DreamCanvas`.
- Always mount `DisplacementCanvas`.
- Replace the `!isWebgl2Available()` case with a one-time toast / fallback screen ("WebGL2 required").
- Keep `prefers-reduced-motion` but apply it by damping shader reactivity (lower `intensity` floor) instead of switching render path.

**Why:** WebGL2 is ~98% browser support. The CSS path has drifted — no reveal, no presets, no RD, no glitch-peek. Keeping it is a perpetual divergence risk.

---

### Tier 2 — research-recommended, worth doing

#### 2. Papari–Kuwahara painterly post-pass · ~2 hr
**Source:** Maxime Heckel — [On Crafting Painterly Shaders](https://blog.maximeheckel.com/posts/on-crafting-painterly-shaders/), Papari polynomial variant (~60 lines GLSL, inline in blog).

**Approach:**
- Append a new pass to `displacement-shaders.ts` between the session-arc palette-temp and the vignette.
- Gate behind a new uniform `uPainterly` (0..1).
- Expose via preset configs in `apps/web/src/lib/render/presets.ts` — add `painterly` field defaulting 0.
- Set `painterly: 0.4` on `wet_ink` and `sumi` presets for a "settled ink edges" feel.

**Why:** Single biggest perceived-quality upgrade available. Edge-preserving smoothing reads as genuine painterly brushwork rather than filter. Drop-in fragment, no pipeline change.

#### 3. Port three ink primitives: salt / cauliflower-backruns / splatter · ~2 hr
**Source:** [JRMeyer/ghostty-watercolors](https://github.com/JRMeyer/ghostty-watercolors) — 9 watercolour GLSL shaders. License not stated — **verify before copying** (issue or PR to ask).

**Approach:**
- Add three new uniforms `uSalt`, `uCauliflower`, `uSplatter` alongside existing `uWashi`/`uDeckle`/`uBokashi`/`uNijimi`/`uDrybrush` in `displacement-shaders.ts`.
- Each follows the same gate-when-0 pattern as existing primitives.
- Cauliflower backruns are the biggest win — a sumi-e staple we're missing.
- Add to preset configs where appropriate.

**Why:** Extends the aesthetic vocabulary without structural change. Each is 5–15 lines GLSL.

---

### Tier 3 — optional, pending decisions

#### 4. ~~lygia modular `#include` refactor~~ — dropped
License (Prosperity + Patron dual) requires non-commercial use or sponsorship, incompatible with a proprietary project. Monolithic shader stays.

#### 5. Fluid-sim preset (Navier-Stokes) · ~1 day
**Source:** [PavelDoGreat/WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation), MIT, 16.3k stars.

**Approach:**
- Create a sibling to `rd-layer.ts` → `fluid-layer.ts` running a NS solver at 256×256 or 512×512.
- Inject onset impulses as velocity splats.
- Sample the velocity FBO as a displacement field for the FLUX image.
- New preset `fluids` in `presets.ts` toggling this on.

**Why:** A new aesthetic preset alongside RD, not a replacement. Extends range; doesn't add maintenance on existing paths.

**Skip if:** we're focused on cleanup. This is additive.

---

## Deferred (explicit)

- **Session god-object refactor** — per your call, defer.
- **Visualizer store split** — low urgency.
- **Shader monolith refactor** (beyond lygia includes) — agents agreed monolithic is fine for a niche aesthetic.
- **Effect overlays vs shader effects audit** — low value.

---

## Suggested execution order

1. **Tier 1 #1** — delete CSS fallback. Clean scope-bounded win.
2. **Tier 2 #2** — add Papari–Kuwahara pass. Immediate perceptual payoff.
3. **Tier 2 #3** — port ink primitives (after license check on ghostty-watercolors).
4. ~~Decide on Tier 3 #4 (lygia)~~ — dropped (license incompatible).
5. **Tier 3 #5 (fluids preset)** — only if adding features, not cleaning up.

Stop anywhere along the line without regret — each tier is independently shippable.
