// Simple "is this actually music?" gate. Used client-side to suppress
// `audio.features` upstream during silence or non-musical audio (voice,
// ambient noise, applause). Returns true when both:
//   - spectralFlatness is low (tonal content, not noise-like) — 10 s EMA
//   - onset rate is at least 0.5/s over the last 10 s
//
// Defaults are tuned for mic input in a home/club setting. Tweak if needed.

const WINDOW_MS = 10_000;
const FLATNESS_THRESHOLD = 0.6;
const ONSET_RATE_THRESHOLD = 0.5; // per second

export interface MusicalityGate {
  update(now: number, flatness: number, onset: boolean): boolean;
  isMusic(): boolean;
}

export function createMusicalityGate(): MusicalityGate {
  const onsets: number[] = []; // timestamps of onsets within the window
  let flatnessEma = 1.0;
  const flatnessAlpha = 0.05; // ~10 s window at 60 Hz equivalent

  let current = false;

  function computeIsMusic(now: number): boolean {
    // Trim old onsets.
    const cutoff = now - WINDOW_MS;
    while (onsets.length > 0 && (onsets[0] ?? 0) < cutoff) onsets.shift();
    const onsetRate = onsets.length / (WINDOW_MS / 1000);
    return flatnessEma < FLATNESS_THRESHOLD && onsetRate > ONSET_RATE_THRESHOLD;
  }

  return {
    update(now, flatness, onset) {
      flatnessEma = flatnessEma + flatnessAlpha * (flatness - flatnessEma);
      if (onset) onsets.push(now);
      current = computeIsMusic(now);
      return current;
    },
    isMusic() {
      return current;
    },
  };
}
