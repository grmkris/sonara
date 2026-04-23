// Effects-deck preset registry. A preset is a partial override of the
// shader's configurable uniforms + optional LFO drift descriptors.
//
// Uniforms default to the `BASE` config when a preset omits them. Cross-fades
// between presets (handled in DisplacementCanvas) lerp every field over ~2s
// so switches never jolt.

import {
  VISUAL_PRESET_DESCRIPTIONS,
  VISUAL_PRESET_NAMES,
  type VisualPresetName,
} from "@music-visualizer/shared";
import { randomWalk, sineLfo, type LfoDriver } from "./lfo";

export type PresetName = VisualPresetName;

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
  // Paper/ink primitives (0 = off, 1 = full)
  washi: number; // paper-fiber texture overlay
  deckle: number; // torn-paper edge
  bokashi: number; // wet gradient wash
  nijimi: number; // ink bleed at dark boundaries
  drybrush: number; // rough-brush highlight streaks
  // Light primitives (0 = off, 1 = full)
  halation: number; // highlight bloom spread
  focal: number; // radial depth-of-field
  godray: number; // directional light shafts
  grain: number; // film grain
  // Color/geometry primitives (0 = off, 1 = full)
  curl: number; // curl-noise UV warp
  dither: number; // ordered Bayer dither
  seal: number; // kanji stamp overlay
  enso: number; // single-stroke circle accent
  // Watercolor primitives (0 = off, 1 = full)
  wetEdge: number; // dark bleed ring at luminance boundaries (classic sumi-e)
  granulation: number; // pigment speckle on mid-tones from fbm noise
  halftone: number; // printmaking dot/line screen overlay
  // Papari–Kuwahara polynomial painterly filter. 0 = off, 1 = full mix.
  painterly: number;
  // Watercolour traditions.
  // salt: crystalline absorption spots — bright centres with dark pigment halos,
  //   scattered sparsely, mid-tone gated.
  // cauliflower: wet-on-damp backrun — fractal dark ring with lighter interior,
  //   uses domain-warped fbm for organic edges.
  // splatter: brush-flick droplets — dark soft disks of varied size.
  salt: number;
  cauliflower: number;
  splatter: number;
  // Gray-Scott reaction-diffusion overlay.
  // rd: amount (0 = off, 1 = fully blended ink-density mask).
  // rdFeed / rdKill: parameter zone (see rd-layer.ts for Pearson zones).
  rd: number;
  rdFeed: number;
  rdKill: number;
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
  washi: 0,
  deckle: 0,
  bokashi: 0,
  nijimi: 0,
  drybrush: 0,
  halation: 0,
  focal: 0,
  godray: 0,
  grain: 0,
  curl: 0,
  dither: 0,
  seal: 0,
  enso: 0,
  wetEdge: 0,
  granulation: 0,
  halftone: 0,
  painterly: 0,
  salt: 0,
  cauliflower: 0,
  splatter: 0,
  rd: 0,
  // Default to "spots" zone per Pearson. Active when rd > 0.
  rdFeed: 0.037,
  rdKill: 0.060,
};

// Preset registry. Order roughly "closest to baseline" → "most distinct".
// Keys MUST match `VISUAL_PRESET_NAMES` in `packages/shared/src/visual-presets.ts`.
export const PRESETS: Record<PresetName, PresetConfig> = {
  wet_ink: { ...BASE, wetEdge: 0.4, granulation: 0.25, painterly: 0.35, salt: 0.3 },

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
    splatter: 0.35,
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

  paper_rain: {
    ...BASE,
    noiseMult: 0.4,
    feedbackAmount: 0.28,
    duotoneMix: 0.25,
    duotoneLo: [0.10, 0.11, 0.14],
    duotoneHi: [0.90, 0.91, 0.88],
    bloomMult: 0.9,
    washi: 0.35,
    grain: 0.15,
    splatter: 0.3,
    // Subtle drift of dissolving spots — like rain spots settling on paper.
    rd: 0.3,
    rdFeed: 0.029,
    rdKill: 0.057,
  },

  bone_china: {
    ...BASE,
    duotoneMix: 0.55,
    duotoneLo: [0.20, 0.18, 0.18],
    duotoneHi: [0.97, 0.95, 0.90],
    edge: 0.4,
    noiseMult: 0.45,
    bloomMult: 0.8,
    washi: 0.45,
    grain: 0.18,
    granulation: 0.4,
    wetEdge: 0.25,
    painterly: 0.45,
    salt: 0.25,
  },

  tide_pool: {
    ...BASE,
    polarWarp: 0.22,
    feedbackAmount: 0.3,
    duotoneMix: 0.5,
    duotoneLo: [0.06, 0.12, 0.14],
    duotoneHi: [0.72, 0.92, 0.86],
    bloomMult: 1.05,
    noiseMult: 0.8,
    curl: 0.5,
    bokashi: 0.45,
    wetEdge: 0.55,
    granulation: 0.35,
    cauliflower: 0.45,
    // Pearson "spots" zone — discrete organic dots that form, persist, divide.
    rd: 0.45,
    rdFeed: 0.037,
    rdKill: 0.060,
  },

  struck_bell: {
    ...BASE,
    polarWarp: 0.12,
    feedbackAmount: 0.18,
    bloomMult: 1.15,
    noiseMult: 0.35,
    edge: 0.25,
    halation: 0.3,
    enso: 0.35,
  },

  copper_wire: {
    ...BASE,
    edge: 1.0,
    bloomMult: 1.1,
    duotoneMix: 0.7,
    duotoneLo: [0.06, 0.10, 0.16],
    duotoneHi: [0.94, 0.62, 0.28],
    noiseMult: 0.5,
    halation: 0.4,
    godray: 0.25,
  },

  ash_field: {
    ...BASE,
    duotoneMix: 0.7,
    duotoneLo: [0.12, 0.12, 0.12],
    duotoneHi: [0.72, 0.70, 0.68],
    feedbackAmount: 0.42,
    noiseMult: 0.35,
    bloomMult: 0.7,
    grain: 0.25,
    focal: 0.4,
    // Pearson "mitosis" zone — cells divide and spread slowly, ghostly trails.
    rd: 0.5,
    rdFeed: 0.014,
    rdKill: 0.054,
  },

  knife_cut: {
    ...BASE,
    edge: 1.7,
    posterizeAlways: 5,
    invert: 0.15,
    noiseMult: 0.4,
    bloomMult: 0.5,
    deckle: 0.3,
    dither: 0.4,
  },

  worn_linen: {
    ...BASE,
    duotoneMix: 0.45,
    duotoneLo: [0.18, 0.16, 0.13],
    duotoneHi: [0.90, 0.86, 0.75],
    posterizeAlways: 8,
    noiseMult: 0.5,
    edge: 0.2,
    bloomMult: 0.85,
    washi: 0.5,
    deckle: 0.3,
    drybrush: 0.25,
    painterly: 0.35,
  },

  salt_flat: {
    ...BASE,
    posterizeAlways: 5,
    duotoneMix: 0.6,
    duotoneLo: [0.22, 0.22, 0.20],
    duotoneHi: [0.98, 0.97, 0.93],
    noiseMult: 0.25,
    feedbackAmount: 0.1,
    bloomMult: 0.7,
    bokashi: 0.35,
    dither: 0.5,
  },

  lacquer_screen: {
    ...BASE,
    duotoneMix: 0.95,
    duotoneLo: [0.04, 0.02, 0.02],
    duotoneHi: [0.78, 0.12, 0.10],
    bloomMult: 1.2,
    feedbackAmount: 0.2,
    noiseMult: 0.45,
    edge: 0.3,
    halation: 0.35,
    seal: 0.6,
  },

  cut_crystal: {
    ...BASE,
    kaleidoSegments: 8,
    polarWarp: 0.18,
    edge: 0.9,
    bloomMult: 1.25,
    noiseMult: 0.55,
    godray: 0.35,
    halation: 0.3,
  },

  long_exposure: {
    ...BASE,
    feedbackAmount: 0.6,
    bloomMult: 1.15,
    noiseMult: 0.35,
    duotoneMix: 0.3,
    duotoneLo: [0.08, 0.09, 0.12],
    duotoneHi: [0.92, 0.90, 0.88],
    halation: 0.45,
    focal: 0.35,
    painterly: 0.4,
  },

  transfer_paper: {
    ...BASE,
    kaleidoSegments: 2,
    edge: 0.55,
    noiseMult: 0.7,
    posterizeAlways: 7,
    duotoneMix: 0.4,
    duotoneLo: [0.12, 0.10, 0.14],
    duotoneHi: [0.88, 0.86, 0.82],
    bloomMult: 0.9,
    nijimi: 0.4,
    dither: 0.3,
    halftone: 0.5,
  },
};

export const PRESET_NAMES: readonly PresetName[] = VISUAL_PRESET_NAMES;

// Short 1-line descriptors used in UI tooltips. Re-exported from shared so
// the server-side LLM prompt and the UI share one source of truth.
export const PRESET_DESCRIPTIONS = VISUAL_PRESET_DESCRIPTIONS;

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
    washi: lerpNumber(a.washi, b.washi, k),
    deckle: lerpNumber(a.deckle, b.deckle, k),
    bokashi: lerpNumber(a.bokashi, b.bokashi, k),
    nijimi: lerpNumber(a.nijimi, b.nijimi, k),
    drybrush: lerpNumber(a.drybrush, b.drybrush, k),
    halation: lerpNumber(a.halation, b.halation, k),
    focal: lerpNumber(a.focal, b.focal, k),
    godray: lerpNumber(a.godray, b.godray, k),
    grain: lerpNumber(a.grain, b.grain, k),
    curl: lerpNumber(a.curl, b.curl, k),
    dither: lerpNumber(a.dither, b.dither, k),
    seal: lerpNumber(a.seal, b.seal, k),
    enso: lerpNumber(a.enso, b.enso, k),
    wetEdge: lerpNumber(a.wetEdge, b.wetEdge, k),
    granulation: lerpNumber(a.granulation, b.granulation, k),
    halftone: lerpNumber(a.halftone, b.halftone, k),
    painterly: lerpNumber(a.painterly, b.painterly, k),
    salt: lerpNumber(a.salt, b.salt, k),
    cauliflower: lerpNumber(a.cauliflower, b.cauliflower, k),
    splatter: lerpNumber(a.splatter, b.splatter, k),
    rd: lerpNumber(a.rd, b.rd, k),
    rdFeed: lerpNumber(a.rdFeed, b.rdFeed, k),
    rdKill: lerpNumber(a.rdKill, b.rdKill, k),
  };
}
