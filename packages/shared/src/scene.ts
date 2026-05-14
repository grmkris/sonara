import { z } from "zod";
import { NowPlaying } from "./now-playing";

export const SonaraSceneState = z.object({
  subject: z.string(),
  action: z.string(),
  environment: z.string(),
  style: z.string(),
  lighting: z.string(),
  palette: z.string(),
  camera: z.string(),
  mood: z.string(),

  softness: z.number().min(0).max(1),
  surrealness: z.number().min(0).max(1),
  abstraction: z.number().min(0).max(1),
  stability: z.number().min(0).max(1),

  // Master audio→visual coupling dial. Composes VU time-constants, onset
  // impulse gain, hue pump range, zoom impulse, periodic AI cadence, pause
  // threshold, onset refractory.
  intensity: z.number().min(0).max(1),

  references: z.array(z.string()),
  version: z.number().int().nonnegative(),

  // Server-authoritative. Set by the song-recognition pipeline; cleared on
  // sustained silence or reset. Clients never patch this field.
  nowPlaying: NowPlaying.optional(),
});

export type SonaraSceneState = z.infer<typeof SonaraSceneState>;

export const SonaraSceneStatePatch = SonaraSceneState.partial();
export type SonaraSceneStatePatch = z.infer<typeof SonaraSceneStatePatch>;

export const defaultScene: SonaraSceneState = {
  subject: "",
  action: "",
  environment: "",
  style: "ethereal, dreamlike",
  lighting: "soft luminous haze",
  palette: "iridescent pastels",
  camera: "",
  mood: "serene, floating",
  softness: 0.8,
  surrealness: 0.7,
  abstraction: 0.6,
  stability: 0.5,
  intensity: 0.5,
  references: [],
  version: 0,
};
