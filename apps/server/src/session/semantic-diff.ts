import type { SonaraSceneState } from "@sonara/shared";

// Field-weighted semantic distance. Returns 0..~2 (unbounded high).
// Threshold ~0.3 = meaningful change, ~1.0 = major scene shift.
// For voice-origin patches the session lowers the effective threshold to 0.1
// so slider-only or near-no-op tweaks still fire a regeneration.
//
// In the collapsed scene-state model the prompt is a single string. Any
// non-trivial edit to the prompt is a "heavy" change — we don't try to
// measure semantic similarity inside the string. Sliders contribute a small
// continuous score so a noticeable drag still re-triggers.
export function semanticDiff(
  prev: SonaraSceneState,
  curr: SonaraSceneState
): number {
  let score = 0;

  // Prompt change — any non-empty edit is a meaningful scene shift. Compare
  // case-/whitespace-normalised so trivial UI churn (trailing newline, casing
  // round-trip through the server) doesn't trigger spuriously.
  const a = prev.prompt.trim().toLowerCase();
  const b = curr.prompt.trim().toLowerCase();
  if (a !== b) {
    score += 1.0;
  }

  // Continuous sliders — delta weighted. Same coefficients as the previous
  // multi-text-field scheme so trigger feel is unchanged for slider drags.
  const sliders: (keyof SonaraSceneState)[] = [
    "softness",
    "surrealness",
    "abstraction",
    "stability",
  ];
  for (const key of sliders) {
    const d = Math.abs(Number(curr[key]) - Number(prev[key]));
    score += d * 0.6;
  }

  return score;
}
