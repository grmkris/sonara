import { z } from "zod";

import { NowPlaying } from "./now-playing";

// Display-only metadata captured at trigger-time and persisted alongside
// each generated frame. Powers the "when this happened" block of the
// /studio frame inspector. Heavyweight enough that we extract only the
// user-facing bits from ResolvedScene (subjects + palette + lighting +
// mood) rather than persisting the full structured object.

export const FrameAudioSnapshotSchema = z.object({
  arousal: z.number(),
  bpm: z.number(),
  rms: z.number(),
  sectionEnergy: z.number(),
  valence: z.number(),
});

export type FrameAudioSnapshot = z.infer<typeof FrameAudioSnapshotSchema>;

export const ResolvedSummarySchema = z.object({
  lighting: z.string().optional(),
  mood: z.string().optional(),
  palette: z.array(z.string()),
  subjects: z.array(z.string()),
});

export type ResolvedSummary = z.infer<typeof ResolvedSummarySchema>;

export const InspectorContextSchema = z.object({
  audio: FrameAudioSnapshotSchema.optional(),
  driftModifier: z.string().optional(),
  nowPlaying: NowPlaying.optional(),
  resolvedSummary: ResolvedSummarySchema.optional(),
});

export type InspectorContext = z.infer<typeof InspectorContextSchema>;
