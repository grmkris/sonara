// Per-preset audio routing.
//
// Historically every preset saw the same audio signals: bass drove uBass,
// kick drove uKick, etc. Preset differences were pure visual — magnitudes
// on the same 23 uniforms — but every preset still reacted to a kick the
// same way, which is the dominant source of "audio sameness" across looks.
//
// This module lets each preset declare WHICH source feeds which shader
// uniform (by logical name). Uniforms the preset doesn't override fall
// back to identity routing (bass→bass, kick→kick, …) — so unrouted
// presets keep their current behaviour exactly.
//
// The resolver runs once per frame before uniform upload; the shader is
// unchanged. See `displacement-canvas.tsx` for the call site.
//
// Example: `frost` is a breath preset that shouldn't react to drum hits
// so its kick slot is driven by rms instead of kick, flattening transients.

import type { PresetName } from "./presets";

export type AudioSource =
  | "rms"
  | "rmsPeak"
  | "bass"
  | "mids"
  | "treble"
  | "kick"
  | "snare"
  | "hat"
  | "vocal";

export interface Route {
  src: AudioSource;
  gain?: number; // default 1.0; post-multiplied after curve
  curve?: "lin" | "pow2" | "sqrt";
}

// Uniform-destination slots that accept routing. Matches the live uniforms
// uploaded in displacement-canvas.tsx.
export interface PresetAudioRouting {
  bass?: Route | AudioSource;
  mids?: Route | AudioSource;
  treble?: Route | AudioSource;
  rms?: Route | AudioSource;
  kick?: Route | AudioSource;
  snare?: Route | AudioSource;
  vocal?: Route | AudioSource;
}

// Sampled audio sources — collected once per frame and fed into resolve().
export interface AudioSourceBundle {
  rms: number;
  rmsPeak: number;
  bass: number;
  mids: number;
  treble: number;
  kick: number;
  snare: number;
  hat: number;
  vocal: number;
}

// Resolved per-frame bundle — the values actually uploaded to shader uniforms.
export interface ResolvedAudio {
  bass: number;
  mids: number;
  treble: number;
  rms: number;
  kick: number;
  snare: number;
  vocal: number;
}

// Routing table. Presets not listed here use pure identity routing.
// Keep entries opinionated and sparse — only override where the preset has
// a genuinely different "ear" than the default.
export const AUDIO_ROUTING: Partial<Record<PresetName, PresetAudioRouting>> = {
  // Contemplative: treat percussion as sustained loudness so nothing twitches.
  dust: {
    kick: { src: "rms", gain: 0.4 },
    snare: { src: "rms", gain: 0.3 },
    bass: { src: "rms" },
    treble: { src: "rms", gain: 0.6 },
  },
  frost: {
    kick: { src: "rms", gain: 0.3 },
    snare: { src: "rms", gain: 0.25 },
    bass: { src: "rms", gain: 0.7 },
  },
  salt_flat: {
    kick: { src: "rms", gain: 0.3 },
    snare: { src: "rms", gain: 0.3 },
    bass: { src: "rms", gain: 0.5 },
    treble: { src: "treble", gain: 0.5 },
  },
  ash_field: {
    kick: { src: "rms", gain: 0.5 },
    snare: { src: "rms", gain: 0.3 },
    bass: { src: "rms" },
  },

  // Percussive: lean into hits.
  ember: {
    bass: { src: "bass", gain: 1.25 },
    kick: { src: "kick", gain: 1.3 },
    treble: { src: "treble", gain: 0.6 },
  },
  storm: {
    bass: { src: "bass", gain: 1.3 },
    kick: { src: "kick", gain: 1.4 },
    snare: { src: "snare", gain: 1.2 },
    treble: { src: "treble", gain: 0.8 },
  },
  knife_cut: {
    kick: { src: "kick", gain: 1.5 },
    snare: { src: "snare", gain: 1.4 },
    bass: { src: "bass", gain: 0.9 },
  },

  // Treble-forward: shimmer and edge.
  neon_line: {
    bass: { src: "treble", gain: 0.5 },
    kick: { src: "snare", gain: 1.2 },
    snare: { src: "snare", gain: 1.3 },
    treble: { src: "treble", gain: 1.4 },
  },
  cut_crystal: {
    bass: { src: "treble", gain: 0.6 },
    treble: { src: "treble", gain: 1.3 },
    kick: { src: "hat", gain: 1.2 },
    snare: { src: "hat", gain: 1.0 },
  },
  copper_wire: {
    bass: { src: "bass", gain: 1.0 },
    treble: { src: "treble", gain: 1.3 },
    kick: { src: "kick", gain: 1.1 },
  },

  // Textural / painterly: flatten hits, breathe on rms.
  paper_rain: {
    kick: { src: "rms", gain: 0.4 },
    snare: { src: "hat", gain: 0.6 },
    bass: { src: "rms" },
  },
  bone_china: {
    kick: { src: "rms", gain: 0.35 },
    snare: { src: "rms", gain: 0.25 },
    bass: { src: "rms", gain: 0.6 },
    treble: { src: "treble", gain: 0.8 },
  },
  worn_linen: {
    kick: { src: "rms", gain: 0.45 },
    snare: { src: "rms", gain: 0.3 },
    bass: { src: "rms", gain: 0.7 },
  },
  long_exposure: {
    // Extreme flattening — long exposure shouldn't twitch on transients
    kick: { src: "rms", gain: 0.25 },
    snare: { src: "rms", gain: 0.2 },
    bass: { src: "rms", gain: 0.8 },
    treble: { src: "rms", gain: 0.5 },
  },

  // Vocal-forward (mandala-like symmetry with voice emphasis).
  mandala: {
    bass: { src: "vocal", gain: 0.9 },
    mids: { src: "vocal", gain: 1.1 },
    kick: { src: "kick", gain: 1.0 },
  },
  lacquer_screen: {
    kick: { src: "kick", gain: 1.1 },
    snare: { src: "vocal", gain: 0.9 },
    bass: { src: "bass", gain: 1.1 },
  },

  // Tide pool / struck bell — harmonic-resolving presets ride on mids/rms.
  tide_pool: {
    kick: { src: "rms", gain: 0.4 },
    snare: { src: "rms", gain: 0.3 },
    mids: { src: "mids", gain: 1.2 },
    bass: { src: "rms", gain: 0.8 },
  },
  struck_bell: {
    kick: { src: "kick", gain: 1.1 },
    snare: { src: "hat", gain: 0.8 },
    treble: { src: "treble", gain: 1.2 },
  },

  // Silent-film: posterize-heavy; bass drives snare-ish flicker.
  silent_film: {
    snare: { src: "kick", gain: 0.8 },
    bass: { src: "rms", gain: 0.9 },
    treble: { src: "treble", gain: 0.7 },
  },

  // Transfer paper: misregister — swap bass/treble partially.
  transfer_paper: {
    bass: { src: "treble", gain: 0.7 },
    treble: { src: "bass", gain: 0.7 },
    kick: { src: "kick", gain: 0.9 },
  },
};

function applyRoute(
  route: Route | AudioSource | undefined,
  defaultSrc: AudioSource,
  sources: AudioSourceBundle,
): number {
  if (route === undefined) return sources[defaultSrc];
  const r: Route = typeof route === "string" ? { src: route } : route;
  let v = sources[r.src] ?? 0;
  if (r.curve === "pow2") v = v * v;
  else if (r.curve === "sqrt") v = Math.sqrt(Math.max(0, v));
  if (r.gain !== undefined) v *= r.gain;
  return v;
}

export function resolveAudio(
  preset: PresetName,
  sources: AudioSourceBundle,
): ResolvedAudio {
  const routing = AUDIO_ROUTING[preset];
  return {
    bass: applyRoute(routing?.bass, "bass", sources),
    mids: applyRoute(routing?.mids, "mids", sources),
    treble: applyRoute(routing?.treble, "treble", sources),
    rms: applyRoute(routing?.rms, "rms", sources),
    kick: applyRoute(routing?.kick, "kick", sources),
    snare: applyRoute(routing?.snare, "snare", sources),
    vocal: applyRoute(routing?.vocal, "vocal", sources),
  };
}
