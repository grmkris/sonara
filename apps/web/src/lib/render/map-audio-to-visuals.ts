import type { AudioFeatures } from "@music-visualizer/shared";

// Intensity lerps (see plan D1). `I` ∈ [0..1].
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface IntensityCoefficients {
  vuAttackMs: number;
  vuReleaseMs: number;
  peakOvershoot: number;
  onsetImpulseGain: number;
  huePumpRange: number; // degrees
  zoomImpulseGain: number;
  grainSwellGain: number;
  onsetRefractoryMs: number;
}

export function intensityCoefficients(intensity: number): IntensityCoefficients {
  const I = Math.max(0, Math.min(1, intensity));
  return {
    vuAttackMs: lerp(500, 80, I),
    vuReleaseMs: lerp(1800, 400, I),
    peakOvershoot: lerp(0, 0.03, I),
    onsetImpulseGain: lerp(0, 2, I),
    huePumpRange: lerp(3, 18, I),
    zoomImpulseGain: lerp(0, 2, I),
    grainSwellGain: lerp(0.3, 1.5, I),
    onsetRefractoryMs: lerp(180, 100, I),
  };
}

export interface VisualTargets {
  // Steady-state targets driven by VU envelopes downstream.
  zoom: number;
  bloom: number;
  warp: number;
  blur: number;
  paletteShift: number; // -1..1 along hanko↔indigo axis, pre-scaled by huePumpRange
  motionEnergy: number;
  grainSwell: number;
  vignette: number; // 0..1, 0 = open, 1 = heavy
}

export function targetsFromAudio(
  audio: AudioFeatures,
  intensity: number,
): VisualTargets {
  const coef = intensityCoefficients(intensity);
  const huePumpNorm = coef.huePumpRange / 18; // 0..1, scales centroid→palette

  return {
    zoom: 1 + audio.bass * 0.06 * (0.5 + intensity * 1.5),
    bloom: 0.15 + audio.rms * 0.9,
    warp: audio.bass * 0.6 + audio.mids * 0.25,
    blur: Math.max(0, 0.25 - audio.treble * 0.18),
    // centroid is 0..1; map to -1..1 then scale by huePumpNorm so intensity
    // controls amplitude. Hanko-red ← centroid 0 … indigo → centroid 1.
    paletteShift: (audio.centroid * 2 - 1) * huePumpNorm,
    motionEnergy: audio.rms * 0.7 + audio.bass * 0.3,
    grainSwell: audio.treble * coef.grainSwellGain,
    vignette: Math.max(0, 1 - audio.rms * 1.4),
  };
}
