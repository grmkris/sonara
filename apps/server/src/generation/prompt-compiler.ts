import type { DreamSceneState } from "@music-visualizer/shared";

// Pattern mirrors ai-stilist/packages/wardrobe/src/inspiration/generate-inspiration.ts:36-86 —
// typed state → conditional comma-joined sections. No negative prompts (FLUX.2 guidance).
export function buildPrompt(s: DreamSceneState): string {
  const parts: (string | false)[] = [
    s.subject,
    s.action,
    s.style,
    s.environment,
    s.lighting,
    s.camera,
    s.mood,
    s.palette ? `palette: ${s.palette}` : "",
    s.softness > 0.7 && "soft dream haze, gossamer light",
    s.surrealness > 0.7 && "surreal fluid transformations",
    s.abstraction > 0.6 && "dissolving edges, luminous ambiguity",
    s.stability < 0.4 && "morphing forms, shifting geometry",
    s.preserveIdentity && "maintain subject identity",
    s.preserveComposition && "preserve overall composition",
    s.preservePalette && "preserve color family",
  ];

  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join(", ");
}
