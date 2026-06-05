import { z } from "zod";

import { DECK_LOOK, DEFAULT_CADENCE, DeckKeySchema } from "./decks";
import type { DeckKey } from "./decks";

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
// so both pace identically from one definition. A frame is held longer when the
// music is calm and cut faster when it's loud (intensity 0..1). The range comes
// from the deck's look profile (DECK_LOOK) when given — e.g. Noir holds 12s→7s
// for a chill, slow slideshow — otherwise the app default 6s→2s.
export const libraryCadenceMs = (
  intensity: number,
  deck?: DeckKey | null
): number => {
  const i = Math.max(0, Math.min(1, intensity));
  const { calm, loud } = (deck && DECK_LOOK[deck]?.cadence) || DEFAULT_CADENCE;
  return Math.round(calm + (loud - calm) * i);
};
