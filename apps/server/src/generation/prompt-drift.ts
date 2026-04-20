// Atmospheric micro-modifiers appended to every fal prompt. Never touches the
// subject slot — the compiler still owns subject identity (see prompt-
// compiler.ts). Each modifier is 1–3 words so FLUX.2 doesn't over-weight it.
//
// Pool is curated to stay on-aesthetic (sumi-e / washi / ink-on-paper) and
// avoid concrete nouns that would compete with the user's subject/environment.
const DRIFT_POOL: readonly string[] = [
  // light
  "dappled light",
  "low sun",
  "silver morning",
  "smoked gold",
  "dawn haze",
  "moonstone glow",
  // texture
  "ink wash",
  "wet pigment",
  "paper grain",
  "etched lines",
  "dry brush",
  "soft diffusion",
  // motion
  "slow drift",
  "held breath",
  "cascading",
  "turning air",
  "gathering weight",
  "dissolving",
  // atmosphere
  "dust motes",
  "soft fog",
  "deep shadow",
  "humid air",
  "cold clarity",
  "quiet tension",
];

// Returns a single random modifier, or null if the pool is empty.
export function sampleDrift(): string | null {
  if (DRIFT_POOL.length === 0) return null;
  const idx = Math.floor(Math.random() * DRIFT_POOL.length);
  return DRIFT_POOL[idx] ?? null;
}
