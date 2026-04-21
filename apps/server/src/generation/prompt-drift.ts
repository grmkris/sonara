// Atmospheric micro-modifiers appended to every fal prompt. Never touches the
// subject slot — the compiler still owns subject identity (see prompt-
// compiler.ts). Each modifier is 1–3 words so FLUX.2 doesn't over-weight it.
//
// Pool is curated to stay on-aesthetic (sumi-e / washi / ink-on-paper) and
// avoid concrete nouns that would compete with the user's subject/environment.
//
// Entries are tagged by "act" — the weights are sampled against sessionProgress
// so early sessions lean into `intro` phrases and late sessions into `dissolve`
// phrases. An entry with weights [1, 0.3, 0] is heavy intro, fades by mid, gone
// late. This gives long sessions an arc without any code path knowing about it.
interface DriftEntry {
  phrase: string;
  // Weight per act. 0 = never, 1 = always eligible. Sampling multiplies these
  // by the current-act affinity (intro / build / dissolve) derived from
  // sessionProgress.
  weights: [number, number, number]; // [intro, build, dissolve]
}

const DRIFT_POOL: readonly DriftEntry[] = [
  // light — morning/bright intro, fades to dusk
  { phrase: "dappled light",   weights: [1.0, 0.6, 0.1] },
  { phrase: "silver morning",  weights: [1.0, 0.3, 0.0] },
  { phrase: "dawn haze",       weights: [1.0, 0.2, 0.0] },
  { phrase: "low sun",         weights: [0.2, 0.8, 0.9] },
  { phrase: "smoked gold",     weights: [0.1, 0.8, 1.0] },
  { phrase: "moonstone glow",  weights: [0.0, 0.4, 1.0] },
  // texture — steady through
  { phrase: "ink wash",        weights: [0.8, 1.0, 0.8] },
  { phrase: "wet pigment",     weights: [0.9, 1.0, 0.6] },
  { phrase: "paper grain",     weights: [1.0, 0.8, 0.6] },
  { phrase: "etched lines",    weights: [0.3, 1.0, 0.5] },
  { phrase: "dry brush",       weights: [0.2, 0.9, 1.0] },
  { phrase: "soft diffusion",  weights: [1.0, 0.7, 0.4] },
  // motion — slow intro, more energetic build, dissolving end
  { phrase: "slow drift",      weights: [1.0, 0.6, 0.4] },
  { phrase: "held breath",     weights: [1.0, 0.5, 0.3] },
  { phrase: "cascading",       weights: [0.3, 1.0, 0.6] },
  { phrase: "turning air",     weights: [0.5, 1.0, 0.7] },
  { phrase: "gathering weight",weights: [0.2, 1.0, 0.9] },
  { phrase: "dissolving",      weights: [0.0, 0.4, 1.0] },
  // atmosphere
  { phrase: "dust motes",      weights: [1.0, 0.8, 0.6] },
  { phrase: "soft fog",        weights: [0.8, 0.7, 1.0] },
  { phrase: "deep shadow",     weights: [0.2, 0.8, 1.0] },
  { phrase: "humid air",       weights: [0.4, 1.0, 0.7] },
  { phrase: "cold clarity",    weights: [1.0, 0.5, 0.3] },
  { phrase: "quiet tension",   weights: [0.5, 1.0, 0.7] },
];

// Map sessionProgress (0..1) → per-act affinity (summing to ~1). Triangular
// weights centred on each act's natural time: intro=0.15, build=0.5, dissolve=0.85.
function actWeights(progress: number): [number, number, number] {
  const p = Math.max(0, Math.min(1, progress));
  const tri = (center: number, width: number) =>
    Math.max(0, 1 - Math.abs(p - center) / width);
  const intro = tri(0.15, 0.5);
  const build = tri(0.5, 0.4);
  const dissolve = tri(0.85, 0.5);
  const sum = intro + build + dissolve || 1;
  return [intro / sum, build / sum, dissolve / sum];
}

// Returns a single random modifier biased by sessionProgress. When progress is
// null/undefined we fall back to uniform sampling (preserves old behaviour).
export function sampleDrift(sessionProgress?: number): string | null {
  if (DRIFT_POOL.length === 0) return null;
  if (sessionProgress === undefined) {
    const idx = Math.floor(Math.random() * DRIFT_POOL.length);
    return DRIFT_POOL[idx]?.phrase ?? null;
  }
  const [wi, wb, wd] = actWeights(sessionProgress);
  const weighted = DRIFT_POOL.map((e) => ({
    phrase: e.phrase,
    w: e.weights[0] * wi + e.weights[1] * wb + e.weights[2] * wd,
  }));
  const total = weighted.reduce((s, e) => s + e.w, 0);
  if (total <= 0) return DRIFT_POOL[0]?.phrase ?? null;
  let r = Math.random() * total;
  for (const e of weighted) {
    r -= e.w;
    if (r <= 0) return e.phrase;
  }
  return weighted[weighted.length - 1]?.phrase ?? null;
}

// Priority chain for drift selection:
//   1. Fresh LLM-synthesized drift (preferred when available)
//   2. Most recent voice phrase (raw, if user spoke recently)
//   3. Sampled static atmospheric pool (fallback)
// This makes voice visible immediately (layer 2) while letting the LLM take
// over the moment it finishes synthesizing (layer 1). Never returns null
// unless the entire pool is empty, which it isn't.
export function sampleDriftLayered(opts: {
  llmDrift: string | null;
  latestVoice: string | null;
  sessionProgress?: number;
}): string | null {
  if (opts.llmDrift && opts.llmDrift.trim().length > 0) return opts.llmDrift;
  if (opts.latestVoice && opts.latestVoice.trim().length > 0) return opts.latestVoice;
  return sampleDrift(opts.sessionProgress);
}
