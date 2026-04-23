import { z } from "zod";

// Server-authoritative track identity + cheap enrichment. Populated by the
// AudD recognizer on the server and mirrored into scene.nowPlaying. Richer
// per-song mood / tempo signals come from the live audio analysis loop
// (Meyda chroma, spectral flux, onset detection) — not from a catalog API.
export const NowPlaying = z.object({
  title: z.string(),
  artist: z.string(),
  album: z.string().optional(),
  genre: z.string().optional(),
  releaseYear: z.number().int().optional(),
  albumArtUrl: z.string().url().optional(),
  isrc: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  recognizedAt: z.number().int().nonnegative(),
});
export type NowPlaying = z.infer<typeof NowPlaying>;
