// Effects-deck preset registry. A preset is a partial override of the
// shader's configurable uniforms + optional LFO drift descriptors.
//
// Uniforms default to the `BASE` config when a preset omits them. Cross-fades
// between presets (handled in DisplacementCanvas) lerp every field over ~2s
// so switches never jolt.

import { randomWalk, sineLfo, type LfoDriver } from "./lfo";

export interface PresetConfig {
  // Effect amounts (0 = off)
  kaleidoSegments: number; // 0 or 1 = off, 2..12 active
  polarWarp: number; // radians per unit radius
  posterizeAlways: number; // 0 or <2 = off, else levels (3..16)
  duotoneMix: number; // 0..1
  duotoneLo: [number, number, number];
  duotoneHi: [number, number, number];
  edge: number; // 0..2
  invert: number; // 0..1
  feedbackAmount: number; // 0..0.85
  // Multipliers on top of audio-driven effects
  bloomMult: number; // 1 = baseline
  noiseMult: number; // 1 = baseline displacement amplitude
}

export const BASE: PresetConfig = {
  kaleidoSegments: 0,
  polarWarp: 0,
  posterizeAlways: 0,
  duotoneMix: 0,
  duotoneLo: [0.09, 0.08, 0.07],
  duotoneHi: [0.93, 0.90, 0.84],
  edge: 0,
  invert: 0,
  feedbackAmount: 0,
  bloomMult: 1,
  noiseMult: 1,
};

// Preset registry. Order roughly "closest to baseline" → "most distinct".
export const PRESETS: Record<string, PresetConfig> = {
  wet_ink: { ...BASE },

  ember: {
    ...BASE,
    bloomMult: 1.25,
    posterizeAlways: 9,
    feedbackAmount: 0.25,
    duotoneMix: 0.35,
    duotoneLo: [0.15, 0.06, 0.04],
    duotoneHi: [0.95, 0.76, 0.42],
  },

  frost: {
    ...BASE,
    bloomMult: 0.85,
    noiseMult: 0.55,
    edge: 0.55,
    duotoneMix: 0.5,
    duotoneLo: [0.09, 0.12, 0.18],
    duotoneHi: [0.88, 0.92, 0.98],
  },

  mandala: {
    ...BASE,
    kaleidoSegments: 6,
    polarWarp: 0.35,
    feedbackAmount: 0.15,
  },

  dust: {
    ...BASE,
    bloomMult: 0.75,
    noiseMult: 0.45,
    feedbackAmount: 0.35,
    edge: 0.15,
  },

  storm: {
    ...BASE,
    polarWarp: 0.55,
    noiseMult: 1.3,
    feedbackAmount: 0.1,
    invert: 0.35,
  },

  silent_film: {
    ...BASE,
    duotoneMix: 0.9,
    duotoneLo: [0.09, 0.08, 0.07],
    duotoneHi: [0.92, 0.88, 0.78],
    posterizeAlways: 7,
    edge: 0.35,
    noiseMult: 0.5,
    bloomMult: 0.75,
  },

  neon_line: {
    ...BASE,
    duotoneMix: 1.0,
    duotoneLo: [0.1, 0.11, 0.28],
    duotoneHi: [0.92, 0.32, 0.35],
    edge: 1.2,
    noiseMult: 0.3,
    bloomMult: 0.55,
  },
};

export type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES: PresetName[] = Object.keys(PRESETS) as PresetName[];

// Short 1-line descriptors used in UI tooltips and the LLM preset-picker
// system prompt.
export const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  wet_ink: "balanced sumi-e baseline",
  ember: "burnt orange, volcanic glow",
  frost: "cool, minimal, cold edges",
  mandala: "kaleidoscopic radial symmetry",
  dust: "grainy, slow-motion, soft",
  storm: "aggressive, gritty, swirling",
  silent_film: "duotone sepia, flickering posterize",
  neon_line: "stark signal/indigo, edges maximum",
};

// Per-preset slow drift. Modulates baseline uniforms over tens of seconds so
// even a long stay on one preset doesn't feel static. Amplitude scales with
// each preset's character (ember's palette breathes more than wet_ink's).
export interface PresetDrift {
  bloomMult?: { lfo: LfoDriver; amplitude: number };
  polarWarp?: { lfo: LfoDriver; amplitude: number };
  feedbackAmount?: { lfo: LfoDriver; amplitude: number };
  noiseMult?: { lfo: LfoDriver; amplitude: number };
}

export function makeDriftForPreset(_name: PresetName): PresetDrift {
  return {
    bloomMult: { lfo: sineLfo(45), amplitude: 0.08 },
    polarWarp: { lfo: sineLfo(60), amplitude: 0.05 },
    feedbackAmount: { lfo: randomWalk(0.015), amplitude: 0.06 },
    noiseMult: { lfo: sineLfo(35), amplitude: 0.12 },
  };
}

// Linear interpolation helper used by the cross-fade layer.
export function lerpNumber(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpVec3(
  a: [number, number, number],
  b: [number, number, number],
  t: number,
): [number, number, number] {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function lerpPreset(
  a: PresetConfig,
  b: PresetConfig,
  t: number,
): PresetConfig {
  const k = Math.max(0, Math.min(1, t));
  return {
    kaleidoSegments: lerpNumber(a.kaleidoSegments, b.kaleidoSegments, k),
    polarWarp: lerpNumber(a.polarWarp, b.polarWarp, k),
    posterizeAlways: lerpNumber(a.posterizeAlways, b.posterizeAlways, k),
    duotoneMix: lerpNumber(a.duotoneMix, b.duotoneMix, k),
    duotoneLo: lerpVec3(a.duotoneLo, b.duotoneLo, k),
    duotoneHi: lerpVec3(a.duotoneHi, b.duotoneHi, k),
    edge: lerpNumber(a.edge, b.edge, k),
    invert: lerpNumber(a.invert, b.invert, k),
    feedbackAmount: lerpNumber(a.feedbackAmount, b.feedbackAmount, k),
    bloomMult: lerpNumber(a.bloomMult, b.bloomMult, k),
    noiseMult: lerpNumber(a.noiseMult, b.noiseMult, k),
  };
}
