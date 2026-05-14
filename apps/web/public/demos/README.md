# Demos

Static demo packs shown on the landing page before wallet connect. Each pack is `manifest.json` + `audio.mp3` + N keyframe images. No server, no fal.ai calls at playback — just static assets served by Vercel.

Manifest schema: `packages/shared/src/demo.ts` → `DemoManifest`.

## Current packs

| Slot | Track | Duration | Preset | Artist |
|---|---|---|---|---|
| `koto` | In the place far away | 2:52 | `wet_ink` | harumachimusic |
| `epic` | Epic Cinematic Drama | 2:58 | `storm` | grand_project |
| `lofi` | Lofi Hip Hop Beat | 2:51 | `dust` | tunetank |

Audio license: Pixabay Content License — commercial use permitted, no attribution required. No on-screen credits are rendered.

## Capture workflow (per slug)

Capture a live playthrough, then ingest the result into the manifest. Run once per demo — the browser recorder + bun ingest CLI only exist for this one-off job.

1. Start the full stack:
   ```
   bun run dev
   ```

2. In the browser, open the page with the `?record=<slug>` flag:
   ```
   http://localhost:3000/?record=koto
   ```
   A floating panel labeled `rec · slug koto` appears at the bottom-center.

3. Switch the music source to "file" and select `apps/web/public/demos/koto/audio.mp3`. Wait for the first fal keyframe to render.

4. Click **start** on the recorder panel. Frames arriving from fal (via the normal WS pipeline) are appended to the recorder's in-memory list; the panel shows the running count and elapsed seconds.

5. Let the track play to the end. Click **stop**, then **download** — the browser saves `capture.json`.

6. Move the download into the demo directory:
   ```
   mv ~/Downloads/capture.json apps/web/public/demos/koto/
   ```

7. Run the ingest CLI:
   ```
   bun run --cwd apps/server ingest-demo koto
   ```
   This fetches every fal URL, saves them as `001.jpg`, `002.jpg`, …, rewrites `manifest.json` with local paths + real `durationSec`, validates against the zod schema, and deletes `capture.json`.

8. Commit the new image files + finalized manifest.

Repeat for `epic` and `lofi`.

## Why browser-side capture + CLI ingest

Audio analysis (Meyda) runs in the browser, so the full live pipeline only works client-side. Capturing in the browser means the captured stream is exactly what a live listener would see. Re-hosting the fal CDN images via a bun CLI is cleaner than trying to do filesystem writes from the browser.

## Loading flow

The `DemoPlayer` component (Phase B — landing next) reads `manifest.json`, plays `audio.mp3` through the existing audio analyzer, and dispatches each pinned frame's URL into `useVisualizerStore.pushFrame()` as audio `currentTime` crosses each `frame.t`. The `SonaraCanvas` and `DisplacementCanvas` don't know or care the frame came from a static file instead of WS.
