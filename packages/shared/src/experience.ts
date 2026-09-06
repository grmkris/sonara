import { z } from "zod";

const unit = z.number().min(0).max(1);
export const ExperienceConfig = z.object({
  automatic: z.boolean(),
  flow: unit,
  intensity: unit,
  palette: z.enum(["ember", "lagoon", "acid", "pearl"]),
  reveal: unit,
  seed: z.number().int().min(0).max(2_147_483_647),
  symmetry: unit,
  trails: unit,
  treatment: z.enum(["ink", "silk", "prism"]),
  version: z.literal(2),
});
export type ExperienceConfig = z.infer<typeof ExperienceConfig>;
export const ResponsiveConfig = ExperienceConfig.extend({
  response: unit,
  version: z.literal(3),
});
export type ResponsiveConfig = z.infer<typeof ResponsiveConfig>;
export type MaterialConfig = ExperienceConfig | ResponsiveConfig;
export const DEFAULT_EXPERIENCE: ExperienceConfig = {
  automatic: true,
  flow: 0.45,
  intensity: 0.55,
  palette: "ember",
  reveal: 0.65,
  seed: 7331,
  symmetry: 0.15,
  trails: 0.55,
  treatment: "silk",
  version: 2,
};

export const DEFAULT_RESPONSIVE: ResponsiveConfig = {
  ...DEFAULT_EXPERIENCE,
  response: 0.7,
  version: 3,
};

// Resolved on the audio clock, then recorded verbatim for future replay.
export const MusicalFrame = z.object({
  body: unit,
  brightness: unit,
  confidence: unit,
  phase: unit,
  pulse: unit,
  release: unit,
  space: unit,
  tension: unit,
  time: z.number().nonnegative(),
  weight: unit,
});
export type MusicalFrame = z.infer<typeof MusicalFrame>;
export const EMPTY_MUSIC: MusicalFrame = {
  body: 0,
  brightness: 0,
  confidence: 0,
  phase: 0,
  pulse: 0,
  release: 0,
  space: 1,
  tension: 0,
  time: 0,
  weight: 0,
};
