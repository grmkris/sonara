import { z } from "zod";

// A single AI-generated keyframe pinned to a timestamp in the demo track.
// `t` is seconds from the start of the audio file. `url` is relative to the
// demo's own directory (e.g. "001.webp") OR an absolute URL.
export const DemoFrame = z.object({
  t: z.number().min(0),
  url: z.string().min(1),
});
export type DemoFrame = z.infer<typeof DemoFrame>;

// A demo track — self-contained. Audio plays locally, frames are static
// assets, the visualizer renders as if the frames were streaming in live.
// No server round-trip, no fal.ai calls.
export const DemoManifest = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/, "slug must be kebab-case"),
  title: z.string().min(1),
  artist: z.string().min(1),
  // Attribution / license info — shown in a small corner credit during demo.
  source: z.string().url(),
  license: z.string().min(1),
  // Path relative to the manifest's directory.
  audio: z.string().min(1),
  // Free-form prompt used when the frames were generated. Displayed as
  // placeholder text in the prompt input while the demo plays.
  prompt: z.string().min(1),
  // Preset the demo looks best with. See apps/web/src/lib/render/presets.ts.
  preset: z.string().min(1),
  durationSec: z.number().positive(),
  frames: z.array(DemoFrame),
});
export type DemoManifest = z.infer<typeof DemoManifest>;
