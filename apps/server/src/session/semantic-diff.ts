import type { DreamSceneState } from "@music-visualizer/shared";

// Field-weighted semantic distance. Returns 0..~3 (unbounded high).
// Threshold ~0.3 = meaningful change, ~1.0 = major scene shift.
export function semanticDiff(
  prev: DreamSceneState,
  curr: DreamSceneState,
): number {
  let score = 0;

  // Strong-weight categorical fields (subject/environment reshape the world).
  const heavy: (keyof DreamSceneState)[] = ["subject", "environment", "action"];
  for (const key of heavy) {
    if (prev[key] !== curr[key]) score += 1.0;
  }

  // Medium-weight style fields.
  const medium: (keyof DreamSceneState)[] = [
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
  const sliders: (keyof DreamSceneState)[] = [
    "softness",
    "surrealness",
    "abstraction",
    "stability",
  ];
  for (const key of sliders) {
    const d = Math.abs(Number(curr[key]) - Number(prev[key]));
    score += d * 0.6;
  }

  // Preserve toggles flip the policy; treat as medium weight.
  const toggles: (keyof DreamSceneState)[] = [
    "preserveIdentity",
    "preserveComposition",
    "preservePalette",
  ];
  for (const key of toggles) {
    if (prev[key] !== curr[key]) score += 0.4;
  }

  return score;
}
