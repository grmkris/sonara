import { z } from "zod";

export const DreamSceneState = z.object({
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
  // threshold, onset refractory. See plan doc D1.
  intensity: z.number().min(0).max(1),

  preserveIdentity: z.boolean(),
  preserveComposition: z.boolean(),
  preservePalette: z.boolean(),

  references: z.array(z.string()),
  version: z.number().int().nonnegative(),
});

export type DreamSceneState = z.infer<typeof DreamSceneState>;

export const DreamSceneStatePatch = DreamSceneState.partial();
export type DreamSceneStatePatch = z.infer<typeof DreamSceneStatePatch>;

export const defaultScene: DreamSceneState = {
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
  preserveIdentity: false,
  preserveComposition: false,
  preservePalette: false,
  references: [],
  version: 0,
};
