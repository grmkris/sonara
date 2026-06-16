// Pure DSP helpers for the audio analyzer. Deliberately free of Web Audio deps
// (operate only on plain arrays/numbers) so they can be unit-tested with
// `bun test` and reused across the per-frame pipeline in `analyzer.ts`.

// One-pole high-pass applied to the time-domain byte buffer before RMS. The
// analyser's byte samples are centred on 128; we work on the centred,
// normalised signal (-1..1). DC offset and sub-bass rumble otherwise inflate
// perceived loudness (sub-bass dominating bloom/motionEnergy), so we strip them
// with y[n] = a·(y[n-1] + x[n] − x[n-1]). `a` near 1 = gentle high-pass; for
// content above the cutoff the gain stays ≈1, so mid/high RMS is ~unchanged.
export const weightedRms = (
  time: Uint8Array<ArrayBufferLike>,
  alpha = 0.97
): number => {
  const n = time.length;
  if (n === 0) {
    return 0;
  }
  let prevX = ((time[0] ?? 128) - 128) / 128;
  let y = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i += 1) {
    const x = ((time[i] ?? 128) - 128) / 128;
    y = alpha * (y + x - prevX);
    prevX = x;
    sumSq += y * y;
  }
  return Math.min(1, Math.sqrt(sumSq / n));
};

// Per-band running-peak normaliser. Carries a `peak` that snaps up to new
// maxima and decays slowly toward a floor, so a quiet band (e.g. treble under
// dominant bass) still reaches full range while silence stays silent. The
// floor prevents dividing by ~0 and amplifying noise in quiet passages.
export interface AutoGainState {
  peak: number;
}

export const createAutoGainState = (): AutoGainState => ({ peak: 0 });

export const autoGain = (
  value: number,
  state: AutoGainState,
  opts: { decay?: number; floor?: number } = {}
): number => {
  // decay is per-call (per audio frame, ~60 Hz). 0.9985 ≈ 0.91/s — slow enough
  // to stay stable within a track, fast enough to re-normalise across sections.
  const decay = opts.decay ?? 0.9985;
  const floor = opts.floor ?? 0.08;
  state.peak = Math.max(value, state.peak * decay, floor);
  return Math.min(1, value / state.peak);
};
