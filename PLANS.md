# Upcoming feature plans

Brainstorms parked here. **Review and green-light before implementation begins** — neither item is a green light yet. Both push against existing design invariants and need product decisions first.

Older entries (clickable suggestion chips per scene field, the pre-generated demo image library) shipped in `aaf119a` and `d6181ec` respectively and were removed from this file.

---

## 1. User-uploaded base image as a seed for generated frames

### Status

**Brainstorm — not designed yet.** Open product question first, then architecture.

### Context

Today the pipeline is **text-to-image only**, by deliberate choice. `apps/server/src/generation/fal-provider.ts:5-12` documents the reasoning: the `/edit` endpoint costs ~3.7× per frame, and reference-image identity-lock fights against mid-session subject pivots — we want the next frame to follow the prompt, not blend with a previous hero.

The user-facing idea: let someone upload **their own image** (a band photo, an album cover, a personal photo, a logo) and have generated frames derive from it — same style, same palette, same subject identity riding the audio.

This isn't a small add. It pushes against the stated design invariant. So the plan has to answer: *under what mode does identity-lock become a feature instead of a bug?*

### Open questions to resolve before any code

1. **What does "derive from" mean?**
   - **Style transfer** — keep the user's image as a style anchor, generate new subjects in that style. (Closer to today's free-form prompting; smaller pivot.)
   - **Identity lock** — keep the subject (the user's face, the band, the logo) and vary environment/mood/palette via the existing four-field prompt. (Bigger product shift, more "personalized music video".)
   - **Hybrid** — start identity-locked, decay to style-only as the session progresses or as the prompt diverges.
2. **Which fal endpoint?** `/edit` is the obvious candidate but billing is 1MP in + 1MP out (~3.7× a text-to-image frame). At that cost, demo library frames remain the cheap path and uploads become the premium path. Acceptable? Pricing implication for credits.
3. **Per-session or per-account?** Does the upload live for one session and vanish, or is it a saved asset? Saved means a new DB table, storage retention, GDPR/DSAR surface.
4. **Moderation.** Free-form uploads → NSFW / IP / identity-of-non-consenting-person risks. fal has moderation on inputs but we'd want our own layer; minimum: a `nsfw_detected` flag returned from fal, surface a "rejected" state in the client.

### Sketch of where this would land

- **Storage** — same R2 (or S3) bucket the demo library already needs. New `user_uploads` table with `id`, `userId`, `url`, `width`, `height`, `mimeType`, `status` ("active" | "rejected" | "expired"), `expiresAt`. TTL of e.g. 7 days unless the user is on a paid plan.
- **Upload surface** — drag-drop zone on the visualizer controls panel, or a "+" button next to the prompt fields. Reuse the same controls slot pattern as `SceneTemplatePicker`.
- **Generation switch** — `apps/server/src/session/session.ts` gets a third branch alongside text-to-image and the existing library-mode short-circuit: if the session has an `activeUploadId`, route through a new `apps/server/src/generation/edit-provider.ts` that calls fal `/edit` with the upload URL + the assembled prompt.
- **Credit pricing** — `apps/server/src/credits/credits.service.ts` needs a separate per-frame debit constant for edit-mode (~3–4× the text-to-image rate). Surface the higher cost in the UI before the user enables upload-mode.
- **Conflict with the existing invariant** — the `fal-provider.ts` comment block should be updated, not deleted. Edit-mode coexists; text-to-image stays the default.

### Critical files (when designed)

- `packages/db/src/schema/user-uploads.db.ts` *(new)*
- `apps/server/src/generation/edit-provider.ts` *(new)*
- `apps/server/src/session/session.ts` — third generation branch.
- `apps/server/src/credits/credits.service.ts` — edit-mode debit rate.
- `apps/web/src/components/visualizer/controls/upload-zone.tsx` *(new)*
- `apps/server/src/uploads/upload-routes.ts` *(new)* — presigned-URL endpoint.
- `apps/server/src/generation/fal-provider.ts` — update header comment to note the edit-mode exception.

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
