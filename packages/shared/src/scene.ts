import { z } from "zod";

import { NowPlaying } from "./now-playing";

// Image-anchor sub-object — now a one-shot CHAIN SEED: the next generated
// keyframe conditions on this image (klein/9b/edit), then the chain takes
// over and the anchor clears. URL is a fal.storage CDN address (or any
// fal-fetchable absolute URL — the deck→live handoff passes the deck frame);
// session-bound and dropped on disconnect (no DB row).
export const ImageAnchor = z.object({
  url: z.string(),
});
export type ImageAnchor = z.infer<typeof ImageAnchor>;

export const SonaraSceneState = z.object({
  // Treatment knob — unchanged. Consumed by scene-llm-expander for
  // composition/style modulation, by cadenceFromIntensity for trigger timing.
  abstraction: z.number().min(0).max(1),

  // Set by the server via the dedicated setImageAnchor mutation, never
  // through scene.patch. Client surfaces are auth-gated (PromptInput).
  imageAnchor: ImageAnchor.optional(),

  // Treatment knob — unchanged. Consumed by scene-llm-expander for
  // composition/style modulation, by cadenceFromIntensity for trigger timing.
  intensity: z.number().min(0).max(1),

  // Server-authoritative. Set by the song-recognition pipeline; cleared on
  // sustained silence or reset. Clients never patch this field.
  nowPlaying: NowPlaying.optional(),

  // Single user-facing content field. Replaces the previous 8-field split
  // (subject/action/environment/style/lighting/palette/camera/mood). The
  // server-side scene-llm-expander parses this into the rich ResolvedSceneCore.
  prompt: z.string(),

  // Treatment knobs — unchanged. Consumed by scene-llm-expander for
  // composition/style modulation, by cadenceFromIntensity for trigger timing.
  softness: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),
  surrealness: z.number().min(0).max(1),

  version: z.number().int().nonnegative(),
});

export type SonaraSceneState = z.infer<typeof SonaraSceneState>;

export const SonaraSceneStatePatch = SonaraSceneState.partial();
export type SonaraSceneStatePatch = z.infer<typeof SonaraSceneStatePatch>;

export const defaultScene: SonaraSceneState = {
  abstraction: 0.6,
  // Calmer out-of-the-box pace (images linger longer); users raise INTENSITY
  // for faster changes + stronger reactivity.
  intensity: 0.4,
  prompt: "",
  softness: 0.8,
  stability: 0.5,
  surrealness: 0.7,
  version: 0,
};
