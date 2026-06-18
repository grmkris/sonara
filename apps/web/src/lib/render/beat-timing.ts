// Beat-locked reveal timing. Pure + unit-tested.
//
// Stretch/shrink a keyframe crossfade so it *completes on the beat grid*,
// making reveals read as "composed" (resolving on the bar) instead of landing
// at a random wall-clock moment. Given the tempo + the beat phase at the moment
// the crossfade starts, pick a duration whose end snaps to a downbeat at or
// after the base duration. Bounded so slow tempos don't stretch absurdly and
// fast ones don't snap too short; returns the base duration when unlocked.
export const crossfadeMsToBeat = (
  bpm: number,
  phase: number,
  baseMs: number,
  opts?: { minMs?: number; maxMs?: number }
): number => {
  const minMs = opts?.minMs ?? baseMs * 0.6;
  const maxMs = opts?.maxMs ?? baseMs * 1.5;
  if (bpm <= 0) {
    return baseMs;
  }
  const beatMs = 60_000 / bpm;
  // Time from the crossfade start to the next downbeat (phase wraps to 0)...
  let dur = (1 - Math.min(1, Math.max(0, phase))) * beatMs;
  // ...then walk forward by whole beats until we're at or past the base.
  while (dur < baseMs) {
    dur += beatMs;
  }
  return Math.max(minMs, Math.min(maxMs, dur));
};
