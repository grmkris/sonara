import type { SonaraSceneState } from "@sonara/shared";

// Field-weighted semantic distance. Returns 0..~3 (unbounded high).
// Threshold ~0.3 = meaningful change, ~1.0 = major scene shift.
// For voice-origin patches the session lowers the effective threshold to 0.1
// so mood / palette-only tweaks still fire a regeneration.
export function semanticDiff(
  prev: SonaraSceneState,
  curr: SonaraSceneState,
): number {
  let score = 0;

  // Strong-weight categorical fields (subject/environment reshape the world).
  const heavy: (keyof SonaraSceneState)[] = ["subject", "environment", "action"];
  for (const key of heavy) {
    if (prev[key] !== curr[key]) score += 1.0;
  }

  // Medium-weight style fields.
  const medium: (keyof SonaraSceneState)[] = [
    "style",
    "lighting",
    "palette",
    "camera",
    "mood",
  ];
  for (const key of medium) {
    if (prev[key] !== curr[key]) score += 0.5;
  }

  // Continuous sliders — delta weighted.
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
