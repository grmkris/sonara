# Upcoming feature plans

Brainstorms parked here. **Review and green-light before implementation begins** — neither item is a green light yet. Both push against existing design invariants and need product decisions first.

Older entries (clickable suggestion chips per scene field, the pre-generated demo image library) shipped in `aaf119a` and `d6181ec` respectively and were removed from this file.

---

## 1. User-uploaded base image as a seed for generated frames

### Status

**Designed — ready to build.** Decisions locked 2026-05-20. Coexists with §3 (prompt collapse); image-anchor UI ships on top of the collapsed single-prompt surface, but the server work is surface-independent and can land in parallel.

### Context

Today the pipeline is **text-to-image only**, by deliberate choice. `apps/server/src/generation/fal-provider.ts:5-12` documents the reasoning: the `/edit` endpoint costs ~3.7× per frame, and reference-image identity-lock fights against mid-session subject pivots. The header comment narrows on `/edit` specifically — a *style-strength* image reference at low weight is a different parameter and a different code path; it doesn't violate the invariant.

The user-facing idea: someone uploads **their own image** (band photo, album cover, personal photo, logo) and a session-wide *anchor strength* slider controls how strongly generated frames derive from it.

### Locked decisions

1. **Strength control**: three named presets — *style only* (~0.3) / *style + subject* (~0.55) / *lock subject* (~0.8) — mapped to fixed `image_prompt_strength` values. Single dropdown, never a free-floating number.
2. **Storage**: `fal.storage.upload()` only. Returned URL lives on the live `Session` instance in memory. **No R2, no S3, no `user_uploads` DB table.** Session-bound, drops on disconnect. Anon + authed both supported.
3. **Endpoint**: TBD spike — `klein/9b` (current default) is text-only. Need a fal model that accepts `image_prompt` + `image_prompt_strength` (likely a `flux-pro` variant). Confirm per-frame cost before committing.
4. **Pricing**: new debit rate constant for anchor-mode in `credits.service.ts` (likely 2–3× text-to-image rate). Free-tier still applies. Cost surfaced in HUD before user enables.
5. **Moderation, three thin layers**: (a) client-side size/mime/dim pre-check; (b) fal NSFW classifier on the upload itself before accepting; (c) `enable_safety_checker: true` on the anchor-mode generation call (currently `false` for text-mode; anchor-mode flips it). Plus a clickwrap "I have rights to this image". No face-detection / non-consenting-person detection in v1 — documented gap.

### Architecture

- **Upload route** — `apps/server/src/uploads/upload-routes.ts` (new). Multipart POST → fal NSFW classifier → `fal.storage.upload()` → return the fal-hosted URL. Logs URL + sessionId for audit; no DB row.
- **Anchor provider** — `apps/server/src/generation/anchor-provider.ts` (new). Mirrors the shape of `fal-provider.ts:streamPreview` but calls the chosen fal endpoint with `image_url` + `image_prompt_strength` + `enable_safety_checker: true`.
- **Third trigger branch** — `apps/server/src/session/session.ts:477` (`trigger()`). Order: demo-library short-circuit (existing) → image-anchor branch (new, when `imageAnchor.url` set) → text-to-image (existing). Image-anchor overrides anon-pinned demo mode.
- **WS mutation** — `setImageAnchor({ url, strength } | { clear: true })` in `packages/api/src/routers/session.router.ts`, mirroring the existing `setDemoMode` shape.
- **UI surface** — small upload zone + 3-preset dropdown adjacent to the collapsed prompt textarea (paperclip-style). Clickwrap shown on first upload per session.
- **fal-provider.ts header** — narrow "no reference images" → "no `/edit` endpoint, but low-weight `image_prompt` references are a separate path (see `anchor-provider.ts`)". Do not delete the original reasoning.

### Critical files

- `apps/server/src/uploads/upload-routes.ts` *(new)*
- `apps/server/src/generation/anchor-provider.ts` *(new)*
- `apps/server/src/session/session.ts` — third trigger branch + `setImageAnchor` + in-memory `imageAnchor` field.
- `apps/server/src/credits/credits.service.ts` — anchor-mode debit rate.
- `apps/server/src/generation/fal-provider.ts` — narrow header comment.
- `packages/api/src/routers/session.router.ts` — `setImageAnchor` mutation + scene event shape.
- `packages/shared/src/typeid.ts` — if we typeid the upload (probably skip for v1, just use the raw fal URL).
- `apps/web/src/components/visualizer/controls/image-anchor-zone.tsx` *(new)* — upload zone + preset dropdown.
- `apps/web/src/components/visualizer/controls/anchor-clickwrap.tsx` *(new)* — first-use consent.
- `apps/web/src/stores/visualizer/image-anchor-slice.ts` *(new)* — zustand slice.

---

## 2. Stream the visualizer into chat platforms (Slack, Discord, …)

### Status

**Brainstorm — exploratory.** Three plausible shapes, very different complexity. Pick one before designing.

### Context

The visualizer today runs in a browser tab. The instinct: meet users where their music + their chatter already lives — Slack huddles, Discord voice rooms, Twitch streams, Zoom backgrounds. None of these accept "a browser canvas" natively; each has its own ingest contract.

### Three shapes, ordered cheapest → most ambitious

#### Shape A — "Share a clip" (low effort, broad reach)

Record the last N seconds of the visualizer client-side via `MediaRecorder` on the canvas + a `MediaStreamAudioDestinationNode` for the audio. Produce an `.mp4` or `.webm`. Offer a single "Share" button that:
- Posts directly to Slack via the `chat.postMessage` API + `files.upload` (needs a Slack app + per-workspace OAuth).
- Or copies a public link to a hosted clip (uses the same R2 bucket as the upload-mode plan above).

No live streaming. Just *capture → share*. Slack/Discord both handle inline video previews on uploaded files.

**Pros**: small surface area, no server-side video pipeline, no live ingest plumbing, works in every chat tool that renders attachments.
**Cons**: not live — the magic of "the visuals reacting to what we're listening to right now" is lost.

#### Shape B — Live "scene" updates via message edits

A Slack app that posts a message and **edits it every 5–15s** with a fresh still frame URL. Effectively a slideshow inside a chat message — laggy, but live-ish. Uses the same R2 bucket; the server pushes a frame URL to the Slack message edit endpoint on a timer.

**Pros**: technically simple, no media ingest, no WebRTC, no RTMP. Just an HTTP POST loop.
**Cons**: Slack rate-limits message edits (Tier 3 ≈ 50/min/workspace — fine for one room, breaks at scale). Discord has stricter limits. Twitch wouldn't fit at all.

#### Shape C — True live stream out (RTMP / WHIP)

Pipe the visualizer's canvas+audio into a real streaming protocol. Slack doesn't accept third-party RTMP; **Discord** has Go Live but only from a desktop client (no public ingest API for bots); **Twitch / YouTube Live** accept RTMP and would actually work.

Server-side path: client streams canvas via WebRTC to a small Go/Node ingest service, which transcodes to RTMP and pushes to Twitch's ingest. Adds a media-server dependency (likely `mediasoup` or `livekit-egress`) plus per-stream CPU cost.

**Pros**: real live experience, fits Twitch/YouTube naturally.
**Cons**: heavy. Whole new infra surface (media server, RTMP keys per user, possibly egress costs). Slack/Discord still need shape A or B as a side-channel because they're not RTMP destinations.

### Recommended order

Start with **shape A**. It unlocks the share moment, validates demand, reuses storage from the upload-mode plan, and avoids any media-server commitment. If usage shows people actually want *live* feel in Slack specifically, add **shape B** on top. **Shape C** only if there's signal that the audience is on Twitch/YouTube — different product, different go-to-market.

### Open questions before designing

1. Which platform is the *primary* target? Slack and Twitch are very different products.
2. Do we want a B2B "install a Slack app" funnel, or B2C "click share"? The former needs Slack app review, OAuth-per-workspace, manifest, distribution surface.
3. Audio — do we have the right to redistribute the user's music in the clip? Likely yes for personal/share use, but Slack-app distribution might bring DMCA scrutiny. Check before building shape B/C.

### Critical files (when designed — shape A)

- `apps/web/src/components/visualizer/share/recorder.ts` *(new)* — `MediaRecorder` wrapper around the canvas + audio stream.
- `apps/web/src/components/visualizer/share/share-button.tsx` *(new)* — UI surface.
- `apps/server/src/uploads/clip-routes.ts` *(new)* — presigned-URL endpoint for the clip, returns a public share URL.
- `apps/server/src/integrations/slack/` *(new — only if pursuing Slack direct-post)* — OAuth + `files.upload` wrapper.

---

## 3. Collapse scene state to a single prompt field

### Status

**Designed — ready to build.** Decisions locked 2026-05-20. User explicitly chose "real collapse" over the min-change option, accepting that voice intent has to learn to rewrite prompts instead of patching atoms.

### Context

`SonaraSceneState` today carries four fields — `subject`, `environment`, `mood`, `palette` — and the UI exposes one input per field. Each is independently editable; the LLM "song muse" (`apps/server/src/generation/song-muse.ts`) returns those exact four keys; voice intent patches them individually ("warmer" → mutates only `mood`); the trigger guard at `session.ts:506` requires non-empty `scene.subject`.

The 4-field shape is the contract between UI, muse, voice controller, and renderer. **Onboarding cost is real** — new users see four blank inputs and bounce. Modern image-gen UX is one prompt box. The distinctive personality the four fields encode is a brand asset, but its onboarding tax outweighs the differentiation.

### Locked decisions

1. **Drop the four fields entirely.** `SonaraSceneState` becomes `{ prompt: string }`. No "advanced view" hiding the old fields — they're gone.
2. **Muse outputs one sentence.** `song-muse.ts` JSON contract changes to `{ prompt: string }`. Existing 4-field parser/coercion is deleted.
3. **Voice intent rewrites the prompt.** "Make it warmer" calls an LLM with the current prompt + the intent, gets back a new prompt. Cheap fal `any-llm` call, same as the muse. Spike this early — it's the riskiest piece of the refactor.
4. **Templates collapse to one string each.** `SCENE_TEMPLATES` in `packages/shared/src/scene-templates.ts` becomes `{ label: string, prompt: string }[]`. Existing 4-field templates flatten via concatenation as a one-time migration.
5. **Trigger guard becomes empty-prompt.** `session.ts:506` checks `!scene.prompt.trim()` instead of `!scene.subject.trim()`.

### Architecture

- **Shared types** — `packages/shared/src/scene.ts` (or wherever `SonaraSceneState` lives): new shape. Delete `SCENE_FIELDS`, `SceneFieldKey`.
- **Muse** — `apps/server/src/generation/song-muse.ts`: rewrite JSON contract + parser. Output is one sentence ≤ 120 chars, sumi-e-flavoured by default.
- **Voice intent** — wherever voice atoms currently dispatch (likely inline in `session.ts`): replace per-atom patch with a single `rewritePromptWithIntent(currentPrompt, intent)` LLM call. New helper in `apps/server/src/generation/` mirroring `song-muse.ts`.
- **Session** — `apps/server/src/session/session.ts`: simplify scene merge (no more per-field user-touched-flag), update empty guard, update `serializeResolvedScene` to a no-op pass-through.
- **WS contract** — `packages/api/src/routers/session.router.ts`: `scene.patch` shape changes from `Partial<{subject, environment, mood, palette}>` to `{ prompt: string }`.
- **Client UI** — `apps/web/src/components/visualizer/controls/prompt-input.tsx`: replace the `SCENE_FIELDS.map(...)` loop with a single textarea. Delete `field-row.tsx`, `scene-fields.ts`. Keep the commit-flash and sweep animation.
- **Store** — `apps/web/src/stores/visualizer-store.ts`: shrink the scene slice.

### Risks

- **Voice path regression.** The LLM rewrite is slower than an atom patch (300–600 ms vs instant) and can produce a prompt the user didn't expect. Mitigations: stream the rewrite to the UI so the user sees the change land; allow undo. If the rewrite quality is bad, fall back to appending the intent ("warmer") to the prompt.
- **Loss of fine-grained control.** Power-users who liked tweaking just `palette` lose that. Acceptable per the locked direction.
- **Scene-template migration.** Flattening the 4 fields into one sentence per template needs a quick pass for readability. ~10 templates, 10 min of editing.

### Critical files

- `packages/shared/src/scene-templates.ts` — collapse template shape, rewrite each as a single sentence.
- `packages/shared/src/scene.ts` *(or current location)* — new `SonaraSceneState`, drop `SCENE_FIELDS`.
- `apps/server/src/generation/song-muse.ts` — single-sentence output contract.
- `apps/server/src/generation/voice-rewrite.ts` *(new)* — LLM helper for "rewrite this prompt with intent X".
- `apps/server/src/session/session.ts` — simplify merge, update trigger guard, swap voice dispatch.
- `packages/api/src/routers/session.router.ts` — `scene.patch` shape.
- `apps/web/src/components/visualizer/controls/prompt-input.tsx` — single textarea.
- `apps/web/src/lib/scene-fields.ts` — *delete*.
- `apps/web/src/components/visualizer/controls/field-row.tsx` — *delete*.
- `apps/web/src/stores/visualizer-store.ts` — shrink scene slice.

### Order of operations

1. **Spike** the voice-rewrite LLM call in isolation (one file, throwaway). Verify latency + quality before committing the refactor.
2. **Shared types** — change `SonaraSceneState` shape, fix everything that breaks.
3. **Server** — muse, voice, session, templates.
4. **Client** — PromptInput, store, delete dead components.
5. **Smoke test** in browser: text input, voice "warmer", template click, demo mode toggle, anon flow.
