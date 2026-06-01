import { z } from "zod";
import { NowPlaying } from "./now-playing";

// Display-only metadata captured at trigger-time and persisted alongside
// each generated frame. Powers the "when this happened" block of the
// /studio frame inspector. Heavyweight enough that we extract only the
// user-facing bits from ResolvedScene (subjects + palette + lighting +
// mood) rather than persisting the full structured object.

export const FrameAudioSnapshotSchema = z.object({
  valence: z.number(),
  arousal: z.number(),
  bpm: z.number(),
  sectionEnergy: z.number(),
  rms: z.number(),
});

export type FrameAudioSnapshot = z.infer<typeof FrameAudioSnapshotSchema>;

export const ResolvedSummarySchema = z.object({
  subjects: z.array(z.string()),
  palette: z.array(z.string()),
  lighting: z.string().optional(),
  mood: z.string().optional(),
});

export type ResolvedSummary = z.infer<typeof ResolvedSummarySchema>;

export const InspectorContextSchema = z.object({
  audio: FrameAudioSnapshotSchema.optional(),
  nowPlaying: NowPlaying.optional(),
  driftModifier: z.string().optional(),
  resolvedSummary: ResolvedSummarySchema.optional(),
});

export type InspectorContext = z.infer<typeof InspectorContextSchema>;
