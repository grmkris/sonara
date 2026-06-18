// Dual time-constant VU envelope follower with peak-hold and overshoot.
//
// Classic VU meters aren't graphs — they're physical systems with ballistics:
//   - Integration (attack) ~300 ms to reach 99% of sustained tone
//   - Symmetric fall time
//   - 1–3% mechanical overshoot on transients
// PPM (peak programme meter) is the complement:
//   - ~10 ms attack, ~1.5 s release, peak-hold plateau
//
// This module exposes both envelopes simultaneously so a caller can use `value`
// (the slow "needle" VU level) for sustained things like zoom/bloom, and
// `peak` (the fast-attack/slow-release plateau) for punctuate effects like
// onset impulses or flashes.
//
// dt is passed per update (ms since last tick) so the envelope is
// frame-rate-independent — rAF jitter doesn't distort the ballistics.

export interface VuOptions {
  // VU integration time
  attackMs: number;
  // VU fall time
  releaseMs: number;
  // PPM attack (default 10 ms)
  peakAttackMs?: number;
  // PPM release (default 1500 ms)
  peakReleaseMs?: number;
  // 0..0.05, mechanical needle overshoot on rising edge
  overshoot?: number;
  // seed "needle" state (carry-over across rebuilds)
  initialValue?: number;
  // seed peak-hold state (carry-over across rebuilds)
  initialPeak?: number;
}

export interface VuEnvelope {
  update: (raw: number, dtMs: number) => void;
  // the slow VU "needle" level
  value: number;
  // the fast peak-hold plateau
  peak: number;
}

export const createVuEnvelope = (opts: VuOptions): VuEnvelope => {
  const peakAttackMs = opts.peakAttackMs ?? 10;
  const peakReleaseMs = opts.peakReleaseMs ?? 1500;
  const overshoot = opts.overshoot ?? 0;

  let value = opts.initialValue ?? 0;
  let peak = Math.max(opts.initialPeak ?? 0, value);
  // short-lived additive bump on rising edges
  let overshootPulse = 0;
  let rising = false;

  return {
    get peak() {
      return peak;
    },
    update(raw, dtMs) {
      if (dtMs <= 0) {
        return;
      }
      const tauValue = raw > value ? opts.attackMs : opts.releaseMs;
      const tauPeak = raw > peak ? peakAttackMs : peakReleaseMs;

      // First-order low-pass; alpha = 1 - exp(-dt/tau).
      const alphaValue = 1 - Math.exp(-dtMs / Math.max(1, tauValue));
      const alphaPeak = 1 - Math.exp(-dtMs / Math.max(1, tauPeak));

      // Detect the start of a rising edge to inject overshoot. "Rising" means
      // raw is sustained above current value for this tick.
      const nextValue = value + alphaValue * (raw - value);
      const wasRising = rising;
      rising = raw > value;
      if (!wasRising && rising && overshoot > 0) {
        overshootPulse = overshoot;
      }
      // Apply the pulse to this frame's output BEFORE decaying, so the birth
      // tick carries the full overshoot amplitude (was halved on same tick).
      value = nextValue + overshootPulse;
      // Decay for next frame — half-life ~60 ms.
      overshootPulse *= Math.exp(-dtMs / 60);

      peak += alphaPeak * (raw - peak);
      // Peak should never fall below value (peak "holds above" the needle).
      if (peak < value) {
        peak = value;
      }
    },
    get value() {
      return value;
    },
  };
};
