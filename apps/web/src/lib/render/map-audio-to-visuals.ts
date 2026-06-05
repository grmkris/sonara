import type { AudioFeatures } from "@sonara/shared";

// Intensity lerps (see plan D1). `I` ∈ [0..1].
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface IntensityCoefficients {
  vuAttackMs: number;
  vuReleaseMs: number;
  peakOvershoot: number;
  onsetImpulseGain: number;
  // degrees
  huePumpRange: number;
  zoomImpulseGain: number;
  grainSwellGain: number;
  onsetRefractoryMs: number;
}

export const intensityCoefficients = (
  intensity: number
): IntensityCoefficients => {
  const I = Math.max(0, Math.min(1, intensity));
  return {
    grainSwellGain: lerp(0.3, 1.5, I),
    huePumpRange: lerp(3, 18, I),
    onsetImpulseGain: lerp(0, 2, I),
    onsetRefractoryMs: lerp(180, 100, I),
    peakOvershoot: lerp(0, 0.03, I),
    vuAttackMs: lerp(500, 80, I),
    vuReleaseMs: lerp(1800, 400, I),
    zoomImpulseGain: lerp(0, 2, I),
  };
};

export interface VisualTargets {
  // Steady-state targets driven by VU envelopes downstream.
  zoom: number;
  bloom: number;
  warp: number;
  blur: number;
  // -1..1 along signal↔indigo axis, pre-scaled by huePumpRange
  paletteShift: number;
  motionEnergy: number;
  grainSwell: number;
  // 0..1, 0 = open, 1 = heavy
  vignette: number;
}

export const targetsFromAudio = (
  audio: AudioFeatures,
  intensity: number
): VisualTargets => {
  const coef = intensityCoefficients(intensity);
  // 0..1, scales centroid→palette
  const huePumpNorm = coef.huePumpRange / 18;

  return {
    bloom: 0.15 + audio.rms * 0.9,
    // New baseline: fully sharp by default. Only grows during loud-bass,
    // treble-light passages (a "muffled dream" gesture). Most of playback —
    // and all silence — sits at 0, so the image reads crisp instead of
    // permanently out of focus.
    blur: Math.max(0, audio.bass * 0.18 - audio.treble * 0.24),
    grainSwell: audio.treble * coef.grainSwellGain,
    motionEnergy: audio.rms * 0.7 + audio.bass * 0.3,
    // centroid is 0..1; map to -1..1 then scale by huePumpNorm so intensity
    // controls amplitude. Hanko-red ← centroid 0 … indigo → centroid 1.
    paletteShift: (audio.centroid * 2 - 1) * huePumpNorm,
    vignette: Math.max(0, 1 - audio.rms * 1.4),
    warp: audio.bass * 0.6 + audio.mids * 0.25,
    zoom: 1 + audio.bass * 0.06 * (0.5 + intensity * 1.5),
  };
};
