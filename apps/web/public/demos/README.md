# Demos

Static demo packs shown before wallet connect. Each pack = one manifest + one audio file + N pre-captured keyframe images. No server, no fal.ai calls.

Manifest schema: `packages/shared/src/demo.ts` → `DemoManifest`.

## Download the audio (manual — Pixabay requires a browser session)

Open each link, click "Free Download" (choose MP3), and save into the matching directory as `audio.mp3`:

| Slot | URL | Save to |
|---|---|---|
| koto | https://pixabay.com/music/ambient-in-the-place-far-away-japanese-koto-inspirational-calm-music-151182/ | `public/demos/koto/audio.mp3` |
| epic | https://pixabay.com/music/build-up-scenes-epic-cinematic-drama-131725/ | `public/demos/epic/audio.mp3` |
| lofi | https://pixabay.com/music/beats-lofi-hip-hop-beat-387061/ | `public/demos/lofi/audio.mp3` |

After downloading, update each manifest's `artist` field with the real composer name shown on the Pixabay page (the "Music by [name]" line under the player).

## Capture the keyframes (dev tool, lands next)

With `audio.mp3` present in each demo dir:

1. `bun run dev` — start the full stack
2. Hit the `/record` dev route (TODO — will be built on `apps/server`), pass the demo slug
3. The server will pipe the demo audio file through the live pipeline, log every `frame.final` URL + timestamp, and download + re-host the images under the demo dir as `001.webp`, `002.webp`, …
4. Manifest auto-fills `frames[]` + `durationSec`
5. Commit the captured assets

## Loading flow (coming next)

On first page load, a `<DemoPlayer>` picks one manifest, plays `audio.mp3` through the existing audio element (the Meyda analyzer runs as normal), and at each `frame.t` dispatches the pinned URL into `useVisualizerStore.pushFrame`. The `DreamCanvas` + `DisplacementCanvas` are frame-source-agnostic — they don't know or care it came from disk instead of WS.

## Attribution rule

Pixabay Content License is commercial-use OK, no attribution required — but we still show a small corner credit ("source: Pixabay") because it's cheap and transparent.
