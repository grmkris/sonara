import { z } from "zod";

// Server-authoritative track identity + cheap enrichment. Populated by the
// AudD recognizer on the server and mirrored into scene.nowPlaying. Richer
// per-song mood / tempo signals come from the live audio analysis loop
// (Meyda chroma, spectral flux, onset detection) — not from a catalog API.
export const NowPlaying = z.object({
  album: z.string().optional(),
  albumArtUrl: z.string().url().optional(),
  artist: z.string(),
  durationMs: z.number().int().positive().optional(),
  genre: z.string().optional(),
  isrc: z.string().optional(),
  recognizedAt: z.number().int().nonnegative(),
  releaseYear: z.number().int().optional(),
  title: z.string(),
});
export type NowPlaying = z.infer<typeof NowPlaying>;
