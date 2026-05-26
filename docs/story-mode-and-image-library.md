# Story Mode + Session Image Library

> Status: **idea / future**. Captured for later. No code yet. Two related features:
> (1) generate a small *set* of related keyframes per subject and play them as a "story";
> (2) persist every image generated in a play session so users can reuse them.

## Context

Today every keyframe is a **single fresh text-to-image generation** triggered by audio/scene
events (`apps/server/src/session/session.ts` → `streamPreview` in
`apps/server/src/generation/fal-provider.ts`, `num_images: 1`). Between generations the client
crossfades and the shader animates, but each new image is an independent fal call that costs
credits and ~seconds of latency.

The user wants two things:

1. **Story mode** — when a subject is set, generate **~5 images at once with subtle changes**, then
   *play* them (loop/sequence) so the scene "breathes" as a short visual story.
2. **Persistence** — **every image generated during a play session is saved somewhere** so the user
   can browse and **reuse** them later (their own gallery).

Both fit the existing architecture unusually well.

---

## Feature 1 — Story Mode (batch keyframes with subtle variation)

### What exists to build on
- **Seed**: `Session.seed` (`rollSeed()`), passed to fal; `fal-provider.ts` and `anchor-provider.ts`
  both accept an optional `seed`. Same prompt + different seed = subtle variation.
- **Drift trajectory**: `apps/server/src/generation/prompt-drift.ts` already produces a *sequence of
  per-keyframe "drift modifiers"* (short atmospheric clauses) from the LLM's `drift_candidates`
  (`scene-llm-expander.ts`), advancing one slot per keyframe. **This is exactly the "subtle change
  between frames" mechanism** — story mode just generates several of them up front instead of one
  at a time.
- **Character consistency**: the expander keeps `subjects[0].description` byte-stable across
  keyframes so FLUX holds the subject. A story set should reuse that — vary only seed + drift
  modifier, never the subject noun phrase.
- **Client playback**: the displacement canvas already crossfades between frames (`currentFrame`,
  `crossfadeStartedAt`) and keeps a `heroBank` ring buffer of recent frames in `preset-slice.ts`.

### Proposed shape
On a subject/story trigger, the server produces **N keyframes (~5)** as a *story set*:
- Option A (cheapest, least control): single fal call with `num_images: N` — variations are
  seed-random only.
- Option B (recommended): N generations sharing the stable subject, each with a different
  `seed` and the next `driftModifier` from the trajectory → coherent, intentional "subtle changes."
- Emit them as a labelled set (e.g. a new `story.set` event carrying the N URLs + the order), or
  reuse `frame.final` with a `storyId`/`index`.

Then the **client plays the set** as a loop/sequence (crossfading between the N frames on a musical
cadence — section changes / BPM phase) **without new API calls between them**. Net effect: a
living, story-like scene that is *also cheaper* (N images amortised over a long stretch vs. one
call per keyframe).

### Open questions for later
- Cadence: advance story frames on section changes? BPM-locked? Mood-field movement?
- Cost/credits: debit N up front; cap N by tier.
- How story mode coexists with the Mood Field, demo mode, and image-anchor mode (mutually
  exclusive trigger paths in `session.ts`).

---

## Feature 2 — Session Image Library (save & reuse generated images)

### What exists to build on
- **`image_library` table** (`packages/db/src/schema/image-library.db.ts`): `deck`, `prompt`,
  `promptHash`, `model`, `seed`, `url`, `width`, `height`, `palette`, `status`. Currently only holds
  **pre-generated DEMO images** (served by `library-provider.ts`, no fal call). Its shape is almost
  exactly what we need for user-generated images too.
- **fal output URLs** from `streamPreview` are **fal-hosted and ephemeral** (the code already
  handles "dead fal.storage URL" cases in `session.ts`). So we **cannot** just store fal URLs for
  long-term reuse — they need copying to our own storage.
- **Upload path**: `apps/server/src/http/upload.ts` already does `fal.storage.upload(file)` for
  image-anchor uploads — a working pattern for moving bytes, though it targets fal, not our bucket.
- **Reuse mechanism already exists**: `setImageAnchor({ url, strength })` +
  `anchor-provider.ts` let a user **pin an image as a generation reference**. So "reuse a saved
  image" can map onto the existing anchor flow — minimal new surface.

### Proposed shape
1. **Persist on generation**: when `onFinal` lands a keyframe, copy the image bytes into **our own
   object storage** (Railway Volume or R2 — the schema comment already anticipates this:
   *"Stays as a plain string when we swap to absolute URLs from R2 / Railway Volumes later"*), and
   insert a row.
2. **Schema**: either add user/session-scoped columns to `image_library` (add `user_id`,
   `session_id`, `source: "demo" | "generated"`) or add a sibling table `generated_image` reusing
   the same columns + `prompt`, `seed`, `palette`, `created_at`. Keep `palette`/`seed` so a reused
   image can re-seed a matching look.
3. **Gallery UI** (web): a "your images" view (the client `heroBank` is the seed of this) listing a
   user's saved frames with prompt/seed. Actions: **reuse as anchor** (`setImageAnchor`), **replay
   as a story set**, **re-seed a new scene** from its prompt+seed.
4. **Lifecycle**: retention/quota by tier; let users delete; mark `status: "rejected"` to hide.

### Why this is high-leverage
- Turns throwaway fal output into a durable, browsable asset users own.
- Reuses three existing systems: the `image_library` schema, the `imageAnchor` reuse flow, and the
  client `heroBank`.
- Unblocks Story Mode replays (a saved story set can be replayed offline/cheaply).

### Open questions for later
- Storage backend decision: **Railway Volume vs. Cloudflare R2** (cost, CDN, signed URLs). Prod is
  Railway; R2 pairs well with the existing Cloudflare zone.
- Copy-on-final latency/cost (do it async, don't block the crossfade).
- Privacy: are generated images private to the user by default? Shareable?
- Anon sessions (demo-only today) — probably no persistence for anon.

---

## Suggested sequencing
1. **Session Image Library (persistence)** first — it's foundational and reuses the most existing
   code (`image_library` schema, `imageAnchor` reuse, `heroBank`).
2. **Story Mode** second — builds naturally on the drift-trajectory + seed mechanism, and a saved
   story set becomes replayable once persistence exists.

## Key files (for whoever picks this up)
- `apps/server/src/session/session.ts` — trigger pipeline, `seed`, `driftTrajectory`, `onFinal`.
- `apps/server/src/generation/fal-provider.ts` / `anchor-provider.ts` — fal calls, `seed`,
  `num_images`.
- `apps/server/src/generation/prompt-drift.ts` + `scene-llm-expander.ts` — per-keyframe drift /
  `drift_candidates`.
- `apps/server/src/http/upload.ts` — existing bytes-to-storage pattern.
- `packages/db/src/schema/image-library.db.ts` — schema to extend/clone.
- `apps/web/src/stores/visualizer/preset-slice.ts` — `heroBank` (gallery seed).
- `apps/server/src/generation/library-provider.ts` — demo library read path to mirror.
