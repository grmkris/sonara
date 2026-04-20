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
  bpm: z.number().optional(),
  bpmConfidence: z.number().optional(),
  sectionEnergy: z.number(),
  // Emitted when the feature set is available; omitted to keep payloads small
  // on the 5 Hz upstream path. Local consumers still see them in-process.
  chroma: z.array(z.number()).length(12).optional(),
  mfcc: z.array(z.number()).length(13).optional(),
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
};
