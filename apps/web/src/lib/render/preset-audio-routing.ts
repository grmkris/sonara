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
  // default 1.0; post-multiplied after curve
  gain?: number;
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
  ash_field: {
    bass: { src: "rms" },
    kick: { gain: 0.5, src: "rms" },
    snare: { gain: 0.3, src: "rms" },
  },
  // Textural / painterly: flatten hits, breathe on rms.
  bone_china: {
    bass: { gain: 0.6, src: "rms" },
    kick: { gain: 0.35, src: "rms" },
    snare: { gain: 0.25, src: "rms" },
    treble: { gain: 0.8, src: "treble" },
  },
  copper_wire: {
    bass: { gain: 1, src: "bass" },
    kick: { gain: 1.1, src: "kick" },
    treble: { gain: 1.3, src: "treble" },
  },
  cut_crystal: {
    bass: { gain: 0.6, src: "treble" },
    kick: { gain: 1.2, src: "hat" },
    snare: { gain: 1, src: "hat" },
    treble: { gain: 1.3, src: "treble" },
  },
  dust: {
    bass: { src: "rms" },
    kick: { gain: 0.4, src: "rms" },
    snare: { gain: 0.3, src: "rms" },
    treble: { gain: 0.6, src: "rms" },
  },
  // Percussive: lean into hits.
  ember: {
    bass: { gain: 1.25, src: "bass" },
    kick: { gain: 1.3, src: "kick" },
    treble: { gain: 0.6, src: "treble" },
  },
  frost: {
    bass: { gain: 0.7, src: "rms" },
    kick: { gain: 0.3, src: "rms" },
    snare: { gain: 0.25, src: "rms" },
  },
  knife_cut: {
    bass: { gain: 0.9, src: "bass" },
    kick: { gain: 1.5, src: "kick" },
    snare: { gain: 1.4, src: "snare" },
  },
  lacquer_screen: {
    bass: { gain: 1.1, src: "bass" },
    kick: { gain: 1.1, src: "kick" },
    snare: { gain: 0.9, src: "vocal" },
  },
  long_exposure: {
    // Extreme flattening — long exposure shouldn't twitch on transients
    bass: { gain: 0.8, src: "rms" },
    kick: { gain: 0.25, src: "rms" },
    snare: { gain: 0.2, src: "rms" },
    treble: { gain: 0.5, src: "rms" },
  },
  // Vocal-forward (mandala-like symmetry with voice emphasis).
  mandala: {
    bass: { gain: 0.9, src: "vocal" },
    kick: { gain: 1, src: "kick" },
    mids: { gain: 1.1, src: "vocal" },
  },
  // Treble-forward: shimmer and edge.
  neon_line: {
    bass: { gain: 0.5, src: "treble" },
    kick: { gain: 1.2, src: "snare" },
    snare: { gain: 1.3, src: "snare" },
    treble: { gain: 1.4, src: "treble" },
  },
  paper_rain: {
    bass: { src: "rms" },
    kick: { gain: 0.4, src: "rms" },
    snare: { gain: 0.6, src: "hat" },
  },
  // Hard techno ear: lean into the drums so the beat slams the visuals.
  rave: {
    bass: { gain: 1.3, src: "bass" },
    kick: { gain: 1.6, src: "kick" },
    snare: { gain: 1.4, src: "snare" },
    treble: { gain: 1.4, src: "treble" },
  },
  salt_flat: {
    bass: { gain: 0.5, src: "rms" },
    kick: { gain: 0.3, src: "rms" },
    snare: { gain: 0.3, src: "rms" },
    treble: { gain: 0.5, src: "treble" },
  },
  // Silent-film: posterize-heavy; bass drives snare-ish flicker.
  silent_film: {
    bass: { gain: 0.9, src: "rms" },
    snare: { gain: 0.8, src: "kick" },
    treble: { gain: 0.7, src: "treble" },
  },
  storm: {
    bass: { gain: 1.3, src: "bass" },
    kick: { gain: 1.4, src: "kick" },
    snare: { gain: 1.2, src: "snare" },
    treble: { gain: 0.8, src: "treble" },
  },
  struck_bell: {
    kick: { gain: 1.1, src: "kick" },
    snare: { gain: 0.8, src: "hat" },
    treble: { gain: 1.2, src: "treble" },
  },
  // Tide pool / struck bell — harmonic-resolving presets ride on mids/rms.
  tide_pool: {
    bass: { gain: 0.8, src: "rms" },
    kick: { gain: 0.4, src: "rms" },
    mids: { gain: 1.2, src: "mids" },
    snare: { gain: 0.3, src: "rms" },
  },
  // Transfer paper: misregister — swap bass/treble partially.
  transfer_paper: {
    bass: { gain: 0.7, src: "treble" },
    kick: { gain: 0.9, src: "kick" },
    treble: { gain: 0.7, src: "bass" },
  },
  worn_linen: {
    bass: { gain: 0.7, src: "rms" },
    kick: { gain: 0.45, src: "rms" },
    snare: { gain: 0.3, src: "rms" },
  },
};

const applyRoute = (
  route: Route | AudioSource | undefined,
  defaultSrc: AudioSource,
  sources: AudioSourceBundle
): number => {
  if (route === undefined) {
    return sources[defaultSrc];
  }
  const r: Route = typeof route === "string" ? { src: route } : route;
  let v = sources[r.src] ?? 0;
  if (r.curve === "pow2") {
    v *= v;
  } else if (r.curve === "sqrt") {
    v = Math.sqrt(Math.max(0, v));
  }
  if (r.gain !== undefined) {
    v *= r.gain;
  }
  return v;
};

export const resolveAudio = (
  preset: PresetName,
  sources: AudioSourceBundle
): ResolvedAudio => {
  const routing = AUDIO_ROUTING[preset];
  return {
    bass: applyRoute(routing?.bass, "bass", sources),
    kick: applyRoute(routing?.kick, "kick", sources),
    mids: applyRoute(routing?.mids, "mids", sources),
    rms: applyRoute(routing?.rms, "rms", sources),
    snare: applyRoute(routing?.snare, "snare", sources),
    treble: applyRoute(routing?.treble, "treble", sources),
    vocal: applyRoute(routing?.vocal, "vocal", sources),
  };
};
