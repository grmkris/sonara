import type { DreamSceneState, NowPlaying } from "@music-visualizer/shared";
import { defaultScene } from "@music-visualizer/shared";

// Deterministic mapping from a recognized song (plus the live audio mood we
// already compute in the browser) to DreamScene fields. User-authored fields
// are NEVER overwritten — we only fill blanks, where "blank" means the field
// still matches defaultScene. Voice/typed intent always wins over recognition.

// Live audio signals mirrored onto the server by `applyAudio`. These replace
// the per-song mood numbers a catalog API would provide — we already have the
// equivalent at 5 Hz from the client's Meyda + chroma + flux pipeline.
export interface LiveAudio {
  valence: number; // 0..1, bright↔dark
  arousal: number; // 0..1, calm↔energetic
  bpm: number; // 0 if unknown
  flatness: number; // 0..1, spectral flatness — acousticness proxy
}

function isDefault<K extends keyof DreamSceneState>(
  scene: DreamSceneState,
  field: K,
): boolean {
  return scene[field] === defaultScene[field];
}

// Valence × arousal quadrant → mood phrase. Tuned to the existing ethereal /
// sumi-e register.
function moodFromAudio(a: LiveAudio): string {
  const highV = a.valence >= 0.5;
  const highE = a.arousal >= 0.5;
  if (highV && highE) return "bright, surging, kinetic";
  if (highV && !highE) return "warm, serene, luminous";
  if (!highV && highE) return "tense, driving, electric";
  return "cold, brooding, introspective";
}

// Crude but useful genre → palette bucketing. No-genre or no-match tracks
// fall back to a live-audio-driven palette.
const PALETTE_BY_GENRE: Record<string, string> = {
  lofi: "dust, sepia, muted earth",
  "hip-hop": "ember, ink, bruise",
  rap: "ember, ink, bruise",
  electronic: "neon prism, glass, violet",
  house: "neon prism, glass, violet",
  techno: "chrome, ozone, steel",
  edm: "chrome, ozone, steel",
  classical: "parchment, gold leaf, bone",
  jazz: "smoke, brass, cognac",
  ambient: "pale mist, silver, iridescent",
  rock: "oxidized copper, storm grey",
  metal: "obsidian, rust, ash",
  pop: "candy pastels, peach, aqua",
  indie: "faded denim, cream, moss",
  folk: "linen, wheat, bark",
  country: "sunbaked clay, wheat, saddle",
  soul: "velvet plum, amber, rose",
  rnb: "velvet plum, amber, rose",
  "r&b": "velvet plum, amber, rose",
  reggae: "sunwashed green, bone, rust",
  punk: "neon stencil, bleach, black",
};

function paletteFromGenre(genre?: string): string | null {
  if (!genre) return null;
  const k = genre.toLowerCase();
  for (const [key, palette] of Object.entries(PALETTE_BY_GENRE)) {
    if (k.includes(key)) return palette;
  }
  return null;
}

// Spectral flatness is a decent proxy for how "noisy vs tonal" the signal
// is — low flatness ≈ tonal / harmonic / acoustic-feel — so we use it as a
// palette tie-breaker when genre metadata isn't available.
function paletteFromAudio(a: LiveAudio): string {
  if (a.flatness < 0.2 && a.arousal < 0.4) {
    return "linen, parchment, washed graphite";
  }
  if (a.arousal > 0.7) return "magenta shock, chrome, ozone";
  if (a.valence < 0.35) return "cobalt, obsidian, fog";
  return "pearl, pale gold, drift smoke";
}

function cameraFromTempo(bpm: number): string {
  if (!bpm || bpm <= 0) return "slow drift";
  if (bpm < 80) return "slow drift";
  if (bpm < 110) return "patient dolly";
  if (bpm < 140) return "handheld push";
  return "snap-cut whip";
}

export interface MergeResult {
  patch: Partial<DreamSceneState>;
  changed: boolean;
}

export function mergeNowPlayingIntoScene(
  scene: DreamSceneState,
  track: NowPlaying,
  audio: LiveAudio,
): MergeResult {
  const patch: Partial<DreamSceneState> = {};

  if (isDefault(scene, "subject")) {
    patch.subject = `${track.artist} — ${track.title}`;
  }

  if (isDefault(scene, "mood")) {
    patch.mood = moodFromAudio(audio);
  }

  if (isDefault(scene, "palette")) {
    const byGenre = paletteFromGenre(track.genre);
    patch.palette = byGenre ?? paletteFromAudio(audio);
  }

  if (isDefault(scene, "camera")) {
    patch.camera = cameraFromTempo(audio.bpm);
  }

  if (scene.intensity === defaultScene.intensity) {
    patch.intensity = Math.max(0, Math.min(1, audio.arousal));
  }

  return { patch, changed: Object.keys(patch).length > 0 };
}
