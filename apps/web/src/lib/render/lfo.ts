// Slow modulators that add "evolving" character on top of preset defaults.
// Each driver exposes a `.sample(tSec)` → number. Output range is specific
// to the driver kind; callers scale by amplitude where appropriate.

export interface LfoDriver {
  sample(tSec: number): number;
}

// Sine LFO in range [-1, 1]. Phase randomised per-instance so two of the
// same shape don't move in lockstep.
export function sineLfo(periodSec: number, phase0 = Math.random()): LfoDriver {
  const omega = (Math.PI * 2) / Math.max(0.1, periodSec);
  const phi = phase0 * Math.PI * 2;
  return {
    sample(t: number) {
      return Math.sin(t * omega + phi);
    },
  };
}

// Smoothed random walk in range ≈ [-1, 1]. Each call advances by `step * dt`
// toward a new random target when the previous target is reached. Good for
// slow hue / tempo drift where sine would feel mechanical.
export function randomWalk(stepPerSec = 0.05): LfoDriver {
  let lastT: number | null = null;
  let value = 0;
  let target = (Math.random() - 0.5) * 2;
  return {
    sample(t: number) {
      const dt = lastT === null ? 0 : Math.max(0, t - lastT);
      lastT = t;
      if (Math.abs(value - target) < 0.02) {
        target = (Math.random() - 0.5) * 2;
      }
      const dir = Math.sign(target - value) || 1;
      value += dir * stepPerSec * dt;
      if ((dir > 0 && value > target) || (dir < 0 && value < target)) {
        value = target;
      }
      // Clamp so noise can't drift outside the nominal range.
      return Math.max(-1, Math.min(1, value));
    },
  };
}

export type DriftMap = Record<
  string,
  { lfo: LfoDriver; amplitude: number } | undefined
>;
