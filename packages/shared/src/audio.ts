import { z } from "zod";

export const OnsetType = z.enum(["kick", "snare", "hat", "vocal", "other"]);
export type OnsetType = z.infer<typeof OnsetType>;

export const AudioFeatures = z.object({
  rms: z.number(),
  bass: z.number(),
  mids: z.number(),
  treble: z.number(),
  centroid: z.number(),
  flatness: z.number(),
  rolloff: z.number(),
  flux: z.number(),
  onset: z.boolean(),
  onsetType: OnsetType.optional(),
  sectionEnergy: z.number(),
  // 2D mood vector, 0..1, smoothed over ~4s. valence: bright↔dark,
  // arousal: calm↔energetic. Cheap derivation from existing features — fed
  // to the server LLM-drift synthesizer to steer prompt atmosphere.
  valence: z.number(),
  arousal: z.number(),
});

export type AudioFeatures = z.infer<typeof AudioFeatures>;

export const defaultAudio: AudioFeatures = {
  rms: 0,
  bass: 0,
  mids: 0,
  treble: 0,
  centroid: 0,
  flatness: 0,
  rolloff: 0,
  flux: 0,
  onset: false,
  sectionEnergy: 0,
  valence: 0.5,
  arousal: 0,
};
