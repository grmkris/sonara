// Effects-deck preset registry. A preset is a partial override of the
// shader's configurable uniforms + optional LFO drift descriptors.
//
// Uniforms default to the `BASE` config when a preset omits them. Cross-fades
// between presets (handled in DisplacementCanvas) lerp every field over ~2s
// so switches never jolt.

import {
  VISUAL_PRESET_DESCRIPTIONS,
  VISUAL_PRESET_NAMES,
} from "@sonara/shared";
import type { VisualPresetName } from "@sonara/shared";

import { randomWalk, sineLfo } from "./lfo";
import type { LfoDriver } from "./lfo";

export type PresetName = VisualPresetName;

export interface PresetConfig {
  // Effect amounts (0 = off)
  // 0 or 1 = off, 2..12 active
  kaleidoSegments: number;
  // radians per unit radius
  polarWarp: number;
  // 0 or <2 = off, else levels (3..16)
  posterizeAlways: number;
  // 0..1
  duotoneMix: number;
  duotoneLo: [number, number, number];
  duotoneHi: [number, number, number];
  // 0..2
  edge: number;
  // 0..1
  invert: number;
  // 0..0.85
  feedbackAmount: number;
  // Multipliers on top of audio-driven effects
  // 1 = baseline
  bloomMult: number;
  // 1 = baseline displacement amplitude
  noiseMult: number;
  // Paper/ink primitives (0 = off, 1 = full)
  // paper-fiber texture overlay
  washi: number;
  // torn-paper edge
  deckle: number;
  // wet gradient wash
  bokashi: number;
  // ink bleed at dark boundaries
  nijimi: number;
  // rough-brush highlight streaks
  drybrush: number;
  // Light primitives (0 = off, 1 = full)
  // highlight bloom spread
  halation: number;
  // radial depth-of-field
  focal: number;
  // directional light shafts
  godray: number;
  // film grain
  grain: number;
  // Color/geometry primitives (0 = off, 1 = full)
  // curl-noise UV warp
  curl: number;
  // ordered Bayer dither
  dither: number;
  // kanji stamp overlay
  seal: number;
  // single-stroke circle accent
  enso: number;
  // Watercolor primitives (0 = off, 1 = full)
  // dark bleed ring at luminance boundaries (classic sumi-e)
  wetEdge: number;
  // pigment speckle on mid-tones from fbm noise
  granulation: number;
  // printmaking dot/line screen overlay
  halftone: number;
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
  bloomMult: 1,
  bokashi: 0,
  cauliflower: 0,
  curl: 0,
  deckle: 0,
  dither: 0,
  drybrush: 0,
  duotoneHi: [0.93, 0.9, 0.84],
  duotoneLo: [0.09, 0.08, 0.07],
  duotoneMix: 0,
  edge: 0,
  enso: 0,
  feedbackAmount: 0,
  focal: 0,
  godray: 0,
  grain: 0,
  granulation: 0,
  halation: 0,
  halftone: 0,
  invert: 0,
  kaleidoSegments: 0,
  nijimi: 0,
  noiseMult: 1,
  painterly: 0,
  polarWarp: 0,
  posterizeAlways: 0,
  rd: 0,
  // Default to "spots" zone per Pearson. Active when rd > 0.
  rdFeed: 0.037,
  rdKill: 0.06,
  salt: 0,
  seal: 0,
  splatter: 0,
  washi: 0,
  wetEdge: 0,
};

// Preset registry. Order roughly "closest to baseline" → "most distinct".
// Keys MUST match `VISUAL_PRESET_NAMES` in `packages/shared/src/visual-presets.ts`.
// oxlint-disable sort-keys -- intentional preset ordering (baseline→distinct) and
// grouped per-preset uniform ordering are author-curated and load-bearing for readability
export const PRESETS: Record<PresetName, PresetConfig> = {
  wet_ink: {
    ...BASE,
    granulation: 0.25,
    painterly: 0.35,
    salt: 0.3,
    wetEdge: 0.4,
  },

  // Hard, trippy, beat-slamming. The event default for a techno DJ night:
  // imagery stays readable, but the beat reactivity hits harder (noiseMult +
  // boosted drum routing), with feedback trails, a swirl, kick-gated invert,
  // and big bloom for a "very active" feel. Pair with the fast cadence.
  rave: {
    ...BASE,
    // Hard + trippy but kept clean for fast cadence: lighter feedback so old
    // frames don't ghost/linger (which read as "stuck"), a gentler kick-invert
    // accent instead of a jarring full flip, and only a whisper of duotone so
    // varied imagery (pandas, the Great Wall, Shanghai) still reads true.
    // Punch comes from displacement + bloom + swirl reacting hard to the beat.
    noiseMult: 1.5,
    bloomMult: 1.55,
    feedbackAmount: 0.28,
    invert: 0.22,
    polarWarp: 0.28,
    edge: 0.7,
    halation: 0.5,
    duotoneMix: 0.1,
    duotoneLo: [0.1, 0.02, 0.16],
    duotoneHi: [0.3, 0.95, 0.98],
  },

  // The anti-rave. Built for the movie-room "Noir" deck: a chill, dark,
  // low-key nocturne. The single most important difference from `rave` is
  // `invert: 0` — no kick-gated screen flip, so the beat never strobes the
  // frame bright. Low bloom + a gentle, longer feedback give smooth dreamy
  // trails instead of punch; a charcoal-blue→candle-amber duotone keeps the
  // palette muted and warm; grain + focal vignette read filmic and pull the
  // eye inward (and darken the edges). Pair with the slow Noir cadence.
  noir: {
    ...BASE,
    bloomMult: 0.7,
    duotoneHi: [0.82, 0.74, 0.58],
    duotoneLo: [0.04, 0.05, 0.08],
    duotoneMix: 0.4,
    edge: 0.15,
    feedbackAmount: 0.45,
    focal: 0.4,
    grain: 0.22,
    halation: 0.25,
    invert: 0,
    noiseMult: 0.35,
    painterly: 0.3,
  },

  ember: {
    ...BASE,
    bloomMult: 1.25,
    duotoneHi: [0.95, 0.76, 0.42],
    duotoneLo: [0.15, 0.06, 0.04],
    duotoneMix: 0.35,
    feedbackAmount: 0.25,
    posterizeAlways: 9,
  },

  frost: {
    ...BASE,
    bloomMult: 0.85,
    duotoneHi: [0.88, 0.92, 0.98],
    duotoneLo: [0.09, 0.12, 0.18],
    duotoneMix: 0.5,
    edge: 0.55,
    noiseMult: 0.55,
  },

  mandala: {
    ...BASE,
    feedbackAmount: 0.15,
    kaleidoSegments: 6,
    polarWarp: 0.35,
  },

  dust: {
    ...BASE,
    bloomMult: 0.75,
    edge: 0.15,
    feedbackAmount: 0.35,
    noiseMult: 0.45,
  },

  storm: {
    ...BASE,
    feedbackAmount: 0.1,
    invert: 0.35,
    noiseMult: 1.3,
    polarWarp: 0.55,
    splatter: 0.35,
  },

  silent_film: {
    ...BASE,
    bloomMult: 0.75,
    duotoneHi: [0.92, 0.88, 0.78],
    duotoneLo: [0.09, 0.08, 0.07],
    duotoneMix: 0.9,
    edge: 0.35,
    noiseMult: 0.5,
    posterizeAlways: 7,
  },

  neon_line: {
    ...BASE,
    bloomMult: 0.55,
    duotoneHi: [0.92, 0.32, 0.35],
    duotoneLo: [0.1, 0.11, 0.28],
    duotoneMix: 1,
    edge: 1.2,
    noiseMult: 0.3,
  },

  paper_rain: {
    ...BASE,
    noiseMult: 0.4,
    feedbackAmount: 0.28,
    duotoneMix: 0.25,
    duotoneLo: [0.1, 0.11, 0.14],
    duotoneHi: [0.9, 0.91, 0.88],
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
    bloomMult: 0.8,
    duotoneHi: [0.97, 0.95, 0.9],
    duotoneLo: [0.2, 0.18, 0.18],
    duotoneMix: 0.55,
    edge: 0.4,
    grain: 0.18,
    granulation: 0.4,
    noiseMult: 0.45,
    painterly: 0.45,
    salt: 0.25,
    washi: 0.45,
    wetEdge: 0.25,
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
    rdKill: 0.06,
  },

  struck_bell: {
    ...BASE,
    bloomMult: 1.15,
    edge: 0.25,
    enso: 0.35,
    feedbackAmount: 0.18,
    halation: 0.3,
    noiseMult: 0.35,
    polarWarp: 0.12,
  },

  copper_wire: {
    ...BASE,
    bloomMult: 1.1,
    duotoneHi: [0.94, 0.62, 0.28],
    duotoneLo: [0.06, 0.1, 0.16],
    duotoneMix: 0.7,
    edge: 1,
    godray: 0.25,
    halation: 0.4,
    noiseMult: 0.5,
  },

  ash_field: {
    ...BASE,
    duotoneMix: 0.7,
    duotoneLo: [0.12, 0.12, 0.12],
    duotoneHi: [0.72, 0.7, 0.68],
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
    bloomMult: 0.5,
    deckle: 0.3,
    dither: 0.4,
    edge: 1.7,
    invert: 0.15,
    noiseMult: 0.4,
    posterizeAlways: 5,
  },

  worn_linen: {
    ...BASE,
    bloomMult: 0.85,
    deckle: 0.3,
    drybrush: 0.25,
    duotoneHi: [0.9, 0.86, 0.75],
    duotoneLo: [0.18, 0.16, 0.13],
    duotoneMix: 0.45,
    edge: 0.2,
    noiseMult: 0.5,
    painterly: 0.35,
    posterizeAlways: 8,
    washi: 0.5,
  },

  salt_flat: {
    ...BASE,
    bloomMult: 0.7,
    bokashi: 0.35,
    dither: 0.5,
    duotoneHi: [0.98, 0.97, 0.93],
    duotoneLo: [0.22, 0.22, 0.2],
    duotoneMix: 0.6,
    feedbackAmount: 0.1,
    noiseMult: 0.25,
    posterizeAlways: 5,
  },

  lacquer_screen: {
    ...BASE,
    bloomMult: 1.2,
    duotoneHi: [0.78, 0.12, 0.1],
    duotoneLo: [0.04, 0.02, 0.02],
    duotoneMix: 0.95,
    edge: 0.3,
    feedbackAmount: 0.2,
    halation: 0.35,
    noiseMult: 0.45,
    seal: 0.6,
  },

  cut_crystal: {
    ...BASE,
    bloomMult: 1.25,
    edge: 0.9,
    godray: 0.35,
    halation: 0.3,
    kaleidoSegments: 8,
    noiseMult: 0.55,
    polarWarp: 0.18,
  },

  long_exposure: {
    ...BASE,
    bloomMult: 1.15,
    duotoneHi: [0.92, 0.9, 0.88],
    duotoneLo: [0.08, 0.09, 0.12],
    duotoneMix: 0.3,
    feedbackAmount: 0.6,
    focal: 0.35,
    halation: 0.45,
    noiseMult: 0.35,
    painterly: 0.4,
  },

  transfer_paper: {
    ...BASE,
    bloomMult: 0.9,
    dither: 0.3,
    duotoneHi: [0.88, 0.86, 0.82],
    duotoneLo: [0.12, 0.1, 0.14],
    duotoneMix: 0.4,
    edge: 0.55,
    halftone: 0.5,
    kaleidoSegments: 2,
    nijimi: 0.4,
    noiseMult: 0.7,
    posterizeAlways: 7,
  },
};
// oxlint-enable sort-keys

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

export const makeDriftForPreset = (_name: PresetName): PresetDrift => ({
  bloomMult: { amplitude: 0.08, lfo: sineLfo(45) },
  feedbackAmount: { amplitude: 0.06, lfo: randomWalk(0.015) },
  noiseMult: { amplitude: 0.12, lfo: sineLfo(35) },
  polarWarp: { amplitude: 0.05, lfo: sineLfo(60) },
});

// Linear interpolation helper used by the cross-fade layer.
export const lerpNumber = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const lerpVec3 = (
  a: [number, number, number],
  b: [number, number, number],
  t: number
): [number, number, number] => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const lerpPreset = (
  a: PresetConfig,
  b: PresetConfig,
  t: number
): PresetConfig => {
  const k = Math.max(0, Math.min(1, t));
  return {
    bloomMult: lerpNumber(a.bloomMult, b.bloomMult, k),
    bokashi: lerpNumber(a.bokashi, b.bokashi, k),
    cauliflower: lerpNumber(a.cauliflower, b.cauliflower, k),
    curl: lerpNumber(a.curl, b.curl, k),
    deckle: lerpNumber(a.deckle, b.deckle, k),
    dither: lerpNumber(a.dither, b.dither, k),
    drybrush: lerpNumber(a.drybrush, b.drybrush, k),
    duotoneHi: lerpVec3(a.duotoneHi, b.duotoneHi, k),
    duotoneLo: lerpVec3(a.duotoneLo, b.duotoneLo, k),
    duotoneMix: lerpNumber(a.duotoneMix, b.duotoneMix, k),
    edge: lerpNumber(a.edge, b.edge, k),
    enso: lerpNumber(a.enso, b.enso, k),
    feedbackAmount: lerpNumber(a.feedbackAmount, b.feedbackAmount, k),
    focal: lerpNumber(a.focal, b.focal, k),
    godray: lerpNumber(a.godray, b.godray, k),
    grain: lerpNumber(a.grain, b.grain, k),
    granulation: lerpNumber(a.granulation, b.granulation, k),
    halation: lerpNumber(a.halation, b.halation, k),
    halftone: lerpNumber(a.halftone, b.halftone, k),
    invert: lerpNumber(a.invert, b.invert, k),
    kaleidoSegments: lerpNumber(a.kaleidoSegments, b.kaleidoSegments, k),
    nijimi: lerpNumber(a.nijimi, b.nijimi, k),
    noiseMult: lerpNumber(a.noiseMult, b.noiseMult, k),
    painterly: lerpNumber(a.painterly, b.painterly, k),
    polarWarp: lerpNumber(a.polarWarp, b.polarWarp, k),
    posterizeAlways: lerpNumber(a.posterizeAlways, b.posterizeAlways, k),
    rd: lerpNumber(a.rd, b.rd, k),
    rdFeed: lerpNumber(a.rdFeed, b.rdFeed, k),
    rdKill: lerpNumber(a.rdKill, b.rdKill, k),
    salt: lerpNumber(a.salt, b.salt, k),
    seal: lerpNumber(a.seal, b.seal, k),
    splatter: lerpNumber(a.splatter, b.splatter, k),
    washi: lerpNumber(a.washi, b.washi, k),
    wetEdge: lerpNumber(a.wetEdge, b.wetEdge, k),
  };
};
