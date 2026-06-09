# Upcoming feature plans

Brainstorms parked here. **Review and green-light before implementation begins** — this item pushes against existing design invariants and needs a product decision first.

Older entries that shipped have been removed from this file: clickable suggestion chips (`aaf119a`), pre-generated demo image library (`d6181ec`), image-anchor upload (`e7df8c7` + follow-ups in late May 2026), and single-prompt scene collapse (`e7df8c7`). The `docs/*.md` brainstorms (mood field, starter decks, story mode + image library, gesture/camera input, and the rooms & roles live-session refactor in `docs/rooms-and-roles-plan.md`) are separate captures sitting alongside this one.

---

## Stream the visualizer into chat platforms (Slack, Discord, …)

### Status

**Brainstorm — exploratory.** Three plausible shapes, very different complexity. Pick one before designing.

### Context

The visualizer today runs in a browser tab. The instinct: meet users where their music + their chatter already lives — Slack huddles, Discord voice rooms, Twitch streams, Zoom backgrounds. None of these accept "a browser canvas" natively; each has its own ingest contract.

### Three shapes, ordered cheapest → most ambitious

#### Shape A — "Share a clip" (low effort, broad reach)

Record the last N seconds of the visualizer client-side via `MediaRecorder` on the canvas + a `MediaStreamAudioDestinationNode` for the audio. Produce an `.mp4` or `.webm`. Offer a single "Share" button that:
- Posts directly to Slack via the `chat.postMessage` API + `files.upload` (needs a Slack app + per-workspace OAuth).
- Or copies a public link to a hosted clip (needs an object-storage bucket — Railway Volume or R2; see also `docs/story-mode-and-image-library.md` which has the same storage need).

No live streaming. Just *capture → share*. Slack/Discord both handle inline video previews on uploaded files.

**Pros**: small surface area, no server-side video pipeline, no live ingest plumbing, works in every chat tool that renders attachments.
**Cons**: not live — the magic of "the visuals reacting to what we're listening to right now" is lost.

> Adjacent shipped capability: the HUD already records canvas + audio to MP4 client-side (`c14425f`). Shape A is mostly "add a share destination" on top of that recorder.

#### Shape B — Live "scene" updates via message edits

A Slack app that posts a message and **edits it every 5–15s** with a fresh still frame URL. Effectively a slideshow inside a chat message — laggy, but live-ish. Uses the same bucket; the server pushes a frame URL to the Slack message edit endpoint on a timer.

**Pros**: technically simple, no media ingest, no WebRTC, no RTMP. Just an HTTP POST loop.
**Cons**: Slack rate-limits message edits (Tier 3 ≈ 50/min/workspace — fine for one room, breaks at scale). Discord has stricter limits. Twitch wouldn't fit at all.

#### Shape C — True live stream out (RTMP / WHIP)

Pipe the visualizer's canvas+audio into a real streaming protocol. Slack doesn't accept third-party RTMP; **Discord** has Go Live but only from a desktop client (no public ingest API for bots); **Twitch / YouTube Live** accept RTMP and would actually work.

Server-side path: client streams canvas via WebRTC to a small Go/Node ingest service, which transcodes to RTMP and pushes to Twitch's ingest. Adds a media-server dependency (likely `mediasoup` or `livekit-egress`) plus per-stream CPU cost.

**Pros**: real live experience, fits Twitch/YouTube naturally.
**Cons**: heavy. Whole new infra surface (media server, RTMP keys per user, possibly egress costs). Slack/Discord still need shape A or B as a side-channel because they're not RTMP destinations.

### Recommended order

Start with **shape A**. It unlocks the share moment, validates demand, reuses the existing canvas+audio recorder, and avoids any media-server commitment. If usage shows people actually want *live* feel in Slack specifically, add **shape B** on top. **Shape C** only if there's signal that the audience is on Twitch/YouTube — different product, different go-to-market.

### Open questions before designing

1. Which platform is the *primary* target? Slack and Twitch are very different products.
2. Do we want a B2B "install a Slack app" funnel, or B2C "click share"? The former needs Slack app review, OAuth-per-workspace, manifest, distribution surface.
3. Audio — do we have the right to redistribute the user's music in the clip? Likely yes for personal/share use, but Slack-app distribution might bring DMCA scrutiny. Check before building shape B/C.

### Critical files (when designed — shape A)

- `apps/web/src/lib/recording/` — existing canvas+audio MP4 recorder (extend, don't duplicate).
- `apps/web/src/components/visualizer/share/share-button.tsx` *(new)* — UI surface.
- `apps/server/src/http/clip-routes.ts` *(new)* — presigned-URL endpoint for the clip, returns a public share URL.
- `apps/server/src/integrations/slack/` *(new — only if pursuing Slack direct-post)* — OAuth + `files.upload` wrapper.
