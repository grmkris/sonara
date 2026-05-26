# Mood Field — replacing the preset chip wall with a living constellation

## Context

On the right-side `style` tab, the visualizer shows **21 presets as tiny underlined text chips** with cryptic poetic names (`wet_ink`, `bone_china`, `salt_flat`, `lacquer_screen`…), plus a jargon `mode` row (`manual / cycle / section / llm`) and a hidden `+ save` button. Users can't tell what any preset looks like, the list is overwhelming, and the modes are opaque. The user wants this simplified into something easier to understand — ideally something novel that lets people make their own looks.

Two facts about the engine make a much better UI essentially free:

1. **A preset is just a bundle of ~33 blendable numbers** (`PresetConfig` in `apps/web/src/lib/render/presets.ts`). The renderer (`displacement-canvas.tsx`) already **cross-fades/lerps between any two configs**, so *any blend between presets is a valid, smooth state*.
2. **The app already computes the music's live mood** — `valence` (bright↔dark) and `arousal` (calm↔energetic), 0..1, smoothed ~4s — in `analyzer.ts`, and it sits in `store.audio.valence/arousal` every frame. **The client renderer never uses it today** (it's only shipped upstream to the server LLM).

This is Russell's circumplex, already measured. So we build a **Mood Field**: a 2D ink-wash field where presets are stars, a glowing dot shows the music's live mood drifting in real time, and dragging the dot blends between nearby presets. It collapses the chip wall + mode row + save button into one tactile surface. Outcome: a distinctive, on-brand control that's instantly legible and lets users "make their own" look by landing anywhere between stars.

We also ship a **standalone HTML explainer** documenting the whole audio→AI→shader→preset pipeline.

> Built in worktree `worktree-mood-field`.

---

## Deliverable A — HTML explainer (`docs/how-it-works.html`)

A self-contained, single-file `.html` (inline CSS, no build step) styled to match the ink/paper aesthetic (serif headings, mono labels, paper/stone palette). Sections:

- **The pipeline** — diagram of: audio capture (`analyzer.ts`) → 60fps features (RMS, bass/mid/treble, kick/snare/vocal onsets, BPM, mood) → 5Hz upstream → server occasionally generates an AI keyframe (fal.ai/FLUX, ~every 8–16s) → the WebGL shader continuously warps/colors that image to the audio. Emphasize: **server = slow keyframes; client shader = 60fps reactivity; the preset tells the shader *how* to react.**
- **What a preset really is** — table of the ~33 `PresetConfig` knobs (name, range, what it does), pulled from `presets.ts` comments.
- **The 21 presets** — name, one-line description (`VISUAL_PRESET_DESCRIPTIONS`), and where each sits in the new mood field.
- **The Mood Field** — how valence/arousal map to the field and how drag-to-blend works.

This is reference documentation; it has no dependency on the code changes and can be built first.

---

## Deliverable B — The Mood Field UI

### New: `apps/web/src/lib/render/preset-field.ts`
- `PRESET_FIELD: Record<PresetName, { x: number; y: number }>` — hand-authored 0..1 coords for all 21 presets. **x = valence (bright→dark), y = arousal (calm→energetic)** to match `store.audio`. Place by character (e.g. `frost`/`bone_china`/`salt_flat` → bright+calm; `storm`/`neon_line` → dark+energetic; `ember` → warm/mid; `tide_pool` → calm/mid). Author intentionally for a legible, well-spread layout.
- `blendPresetConfigs(entries: { cfg: PresetConfig; weight: number }[]): PresetConfig` — normalized weighted average of every numeric field; lerp the `duotoneLo/duotoneHi` triplets; round integer-ish fields (`kaleidoSegments`, `posterizeAlways`). Mirror the field list already lerped in `displacement-canvas.tsx`'s `lerpPreset`.
- `blendAtPosition(x, y, stars): { cfg, nearestName }` — Gaussian/inverse-distance weights over the star set (built-ins + saved), normalized, fed to `blendPresetConfigs`. Returns the dominant star name for display + persistence.

### Modify: `apps/web/src/stores/visualizer/preset-slice.ts`
- Replace `PresetMode` semantics with **`MoodMode = "follow" | "hold" | "drift"`** (reuse `PRESET_MODE_KEY` for persistence): `follow` = music's mood drives the dot; `hold` = user parked it; `drift` = dot does a slow autonomous random-walk (replaces `cycle`).
- Add `moodPos: { x: number; y: number }` (persisted) and `moodMode`.
- Add `setMoodMode(m)` and `setMoodPos(x, y, opts?)` — the latter sets `moodPos`, computes the blended config via `blendAtPosition`, stores it as `customPreset`, updates `preset` to the dominant star name (keeps glitch-peek/display happy), sets a short fade override, and bumps `presetTick`.
- Add `presetFadeMs: number | null` — set to ~180ms during live drag/follow, cleared (→ default 3500ms) otherwise. Read by the canvas.
- **Saved presets become stars:** change `savedPresets` value shape to `{ cfg: PresetConfig; x: number; y: number }` with a one-time localStorage migration (old `Record<name, PresetConfig>` → wrap as `{ cfg, x: 0.5, y: 0.5 }`). `snapshotCurrentPreset(name)` now records the current `moodPos` too.
- Keep `setPreset`/`selectSavedPreset` working (landing on a star ≡ `setMoodPos` at that star's coords).

### Modify: `apps/web/src/components/visualizer/canvas/displacement-canvas.tsx`
- In `applyPreset` (around line 456), honor the override: `const fade = useVisualizerStore.getState().presetFadeMs ?? PRESET_CROSSFADE_MS;` and use `fade` where `PRESET_CROSSFADE_MS` is consumed for this transition. Everything else (custom-preset precedence, snapshot-as-from) already works — drag updates just re-trigger short fades, reading as smooth tracking.

### New: `apps/web/src/components/visualizer/controls/mood-field.tsx`
- An **SVG field** (~240px square) matching the panel aesthetic: faint axis labels (`bright`/`dark`, `calm`/`energetic`), preset **stars** as small serif labels at their `PRESET_FIELD` coords (saved presets rendered italic w/ bullet, like today), and a **glowing dot** for the current position.
- **Live dot:** subscribe to `store.audio` (60fps) for the displayed dot; throttle the *look application* (blend → `setMoodPos`) to ~12–15Hz.
  - `follow`: target = `(audio.valence, audio.arousal)`; dot eases toward it; look follows.
  - `hold`: dot stays at `moodPos`; ignores audio.
  - `drift`: dot random-walks slowly (reuse `randomWalk` from `apps/web/src/lib/render/lfo.ts`), period from existing `presetCycleMs`.
- **Drag:** pointer events on the SVG → `setMoodPos(x, y)` with the short fade; on release, switch to `hold`. Tapping a star label snaps there.
- **Mode buttons:** `follow · hold · drift` (replaces the old MODES row), same underline styling as current chips.
- **Pin/save:** a `pin here` affordance → prompts a name → `snapshotCurrentPreset(name)`; the new saved star appears at the current dot. Right-click a saved star to delete (preserve current behavior).

### Modify: `apps/web/src/components/visualizer/controls/controls-panel.tsx`
- Swap `<PresetPicker />` (line 90) for `<MoodField />` in the `style` tab.

### Modify: `apps/web/src/hooks/use-ws-session.ts`
- The `preset.suggest` handler currently checks `presetMode === "llm"`. Repoint it: when `moodMode === "follow"`, ease the dot toward the suggested preset's `PRESET_FIELD` coord (LLM nudges the mood instead of hard-switching). Keeps the server LLM feature alive in the new model.

### Retire: `apps/web/src/components/visualizer/controls/preset-picker.tsx`
- Delete after `MoodField` replaces it (only `controls-panel.tsx` imports it). The cycle/section concepts live on as `drift`/`follow`. Verify no other importers via `rg "preset-picker"` before removing.

---

## Reused building blocks
- `lerpPreset` field list + `BASE` / `PRESETS` — `apps/web/src/lib/render/presets.ts`
- `randomWalk` / `sineLfo` — `apps/web/src/lib/render/lfo.ts` (drift mode)
- `customPreset` + `presetTick` crossfade path — already wired in `displacement-canvas.tsx`
- `savedPresets` localStorage machinery — `preset-slice.ts`
- `store.audio.valence/arousal` — already populated 60fps from `analyzer.ts`
- `VISUAL_PRESET_DESCRIPTIONS` — `packages/shared/src/visual-presets.ts` (star tooltips + explainer)

## Suggested build order
1. `docs/how-it-works.html` (standalone, no code deps).
2. `preset-field.ts` (coords + blend math).
3. `preset-slice.ts` state/actions + saved-preset migration; canvas fade override.
4. `mood-field.tsx` — stars + drag + `hold` mode first.
5. Live dot + `follow` mode (audio-driven).
6. `drift` mode + pin/save + saved stars.
7. Wire `preset.suggest`; mount in panel; retire `preset-picker.tsx`.

## Verification
- `bun run dev` (or the project run skill); open `/play`.
- **Hold:** drag the dot around the field → visuals smoothly blend between nearby presets with no jolt; landing on a star matches that preset.
- **Follow:** play audio (mic/file) → the dot drifts with the music's brightness/energy and the look follows; confirm `store.audio.valence/arousal` move it.
- **Drift:** dot wanders on its own; speed tracks `presetCycleMs`.
- **Pin/save:** save a mid-blend → it appears as a star, reloads from localStorage, deletes on right-click; confirm old saved presets migrate without error.
- All 21 presets remain reachable (each is a star).
- `preset.suggest` (follow mode) eases the dot toward the suggested preset.
- Open `docs/how-it-works.html` directly in a browser — renders standalone, diagram + tables correct.
- `bun run typecheck`/lint clean; `rg "preset-picker"` returns nothing after retirement.
