import { z } from "zod";
import { type DeckKey, DeckKeySchema } from "./decks";

// A per-deck list of pre-generated demo frame URLs, served as a static file at
// /library/<deck>/manifest.json. The client demo loop fetches this to drive the
// slideshow entirely in the browser — no server/WebSocket needed for demo, so it
// keeps looping on slow/no internet. Generated from the committed images on disk
// by apps/server/scripts/build-library-manifests.ts.
export interface LibraryManifest {
  deck: DeckKey;
  frames: string[];
}

export const LibraryManifestSchema = z.object({
  deck: DeckKeySchema,
  frames: z.array(z.string()),
});

// Demo frame cadence: how long a library frame is held before the next one.
// Shared by the server session (its periodic trigger) and the client demo loop
// so both pace identically from one definition. intensity 0 (calm) → 6s,
// intensity 1 (loud) → 2s.
export function libraryCadenceMs(intensity: number): number {
  const i = Math.max(0, Math.min(1, intensity));
  return Math.round(6_000 + (2_000 - 6_000) * i);
}
