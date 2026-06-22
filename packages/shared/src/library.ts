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

// Reactive cadence: interpolate a hold time between calm/loud bounds by the
// music's intensity (0..1, clamped). The shared primitive behind deck
// playback and any set with an authored look.
export const cadenceBetweenMs = (
  intensity: number,
  bounds: { calm: number; loud: number }
): number => {
  const i = Math.max(0, Math.min(1, intensity));
  return Math.round(bounds.calm + (bounds.loud - bounds.calm) * i);
};

// Per-frame authored hold duration bounds (frame_set_frame.duration_ms). A
// curated set's timeline can pin how long an individual frame holds on replay,
// overriding the set's reactive look-cadence (WYSIWYG: a clip's width on the
// timeline IS its hold time). Bounds keep one frame from strobing or stalling
// the playback loop. Shared by the server validation (sets.setFrameDuration),
// the client playback loop, and the timeline trim handles so all three agree.
export const MIN_FRAME_DURATION_MS = 200;
export const MAX_FRAME_DURATION_MS = 30_000;

export const clampFrameDurationMs = (ms: number): number =>
  Math.max(
    MIN_FRAME_DURATION_MS,
    Math.min(MAX_FRAME_DURATION_MS, Math.round(ms))
  );

// Demo frame cadence: how long a library frame is held before the next one.
// Shared by the server session (its periodic trigger) and the client playback
// loop so both pace identically from one definition. A frame is held longer
// when the music is calm and cut faster when it's loud. The range comes from
// the deck's look profile (DECK_LOOK) when given — e.g. Noir holds 12s→7s for
// a chill, slow slideshow — otherwise the app default 6s→2s.
export const libraryCadenceMs = (
  intensity: number,
  deck?: DeckKey | null
): number =>
  cadenceBetweenMs(
    intensity,
    (deck && DECK_LOOK[deck]?.cadence) || DEFAULT_CADENCE
  );
