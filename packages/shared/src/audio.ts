import { z } from "zod";

export const AudioFeatures = z.object({
  rms: z.number(),
  bass: z.number(),
  mids: z.number(),
  treble: z.number(),
  centroid: z.number(),
  onset: z.boolean(),
  bpm: z.number().optional(),
  sectionEnergy: z.number(),
});

export type AudioFeatures = z.infer<typeof AudioFeatures>;

export const defaultAudio: AudioFeatures = {
  rms: 0,
  bass: 0,
  mids: 0,
  treble: 0,
  centroid: 0,
  onset: false,
  sectionEnergy: 0,
};
