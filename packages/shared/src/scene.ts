import { z } from "zod";

import { NowPlaying } from "./now-playing";

// Image-anchor sub-object — a user-uploaded image that conditions the next
// generation. Strength comes from a 3-preset client picker (style-only 0.3,
// style+subject 0.55, lock-subject 0.8). URL is a fal.storage CDN address;
// session-bound and dropped on disconnect (no DB row).
export const ImageAnchor = z.object({
  strength: z.number().min(0).max(1),
  url: z.string(),
});
export type ImageAnchor = z.infer<typeof ImageAnchor>;

export const SonaraSceneState = z.object({
  // Single user-facing content field. Replaces the previous 8-field split
  // (subject/action/environment/style/lighting/palette/camera/mood). The
  // server-side scene-llm-expander parses this into the rich ResolvedSceneCore.
  prompt: z.string(),

  // Treatment knobs — unchanged. Consumed by scene-llm-expander for
  // composition/style modulation, by cadenceFromIntensity for trigger timing.
  softness: z.number().min(0).max(1),
  surrealness: z.number().min(0).max(1),
  abstraction: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  intensity: z.number().min(0).max(1),

  // Set by the server via the dedicated setImageAnchor mutation, never
  // through scene.patch. Client surfaces are auth-gated (PromptInput).
  imageAnchor: ImageAnchor.optional(),

  version: z.number().int().nonnegative(),

  // Server-authoritative. Set by the song-recognition pipeline; cleared on
  // sustained silence or reset. Clients never patch this field.
  nowPlaying: NowPlaying.optional(),
});

export type SonaraSceneState = z.infer<typeof SonaraSceneState>;

export const SonaraSceneStatePatch = SonaraSceneState.partial();
export type SonaraSceneStatePatch = z.infer<typeof SonaraSceneStatePatch>;

export const defaultScene: SonaraSceneState = {
  abstraction: 0.6,
  intensity: 0.5,
  prompt: "",
  softness: 0.8,
  stability: 0.5,
  surrealness: 0.7,
  version: 0,
};
