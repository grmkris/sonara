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
  // Harmonic features (Krumhansl-Kessler correlation on a 12-bin chroma).
  // keyStrength = best-fit correlation (0..1, higher = more tonal / resolved).
  // tonalCenter = 0..11 pitch class of the best-matching tonic (C=0, C#=1, …).
  // EMA-smoothed over ~4s.
  keyStrength: z.number(),
  tonalCenter: z.number().int(),
  // Tempo features. bpm is 0 when no stable tempo has been detected yet;
  // otherwise an integer in [60, 180]. bpmPhase is a 0..1 beat clock that
  // wraps once per beat — use for phase-locked motion (not per-hit reactions).
  bpm: z.number(),
  bpmPhase: z.number(),
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
  keyStrength: 0,
  tonalCenter: 0,
  bpm: 0,
  bpmPhase: 0,
};
