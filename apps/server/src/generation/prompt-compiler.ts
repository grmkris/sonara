import type { DreamSceneState } from "@music-visualizer/shared";

// Subject-anchor invariant
// ------------------------
// `subject` is the identity anchor of the scene. It is ALWAYS emitted as the
// first segment of the prompt, byte-identical, never modulated by audio, never
// reordered, never mixed into style/mood clauses. FLUX.2 klein's character
// consistency depends on the subject phrase staying in a stable position with a
// stable spelling across keyframes. If future code needs to append
// audio-reactive modifiers, they must go AFTER every other segment — never
// touch the subject slot.
//
// Pattern mirrors ai-stilist/packages/wardrobe/src/inspiration/generate-inspiration.ts:36-86.
export function buildPrompt(s: DreamSceneState): string {
  const subject = s.subject.trim();
  if (subject.length === 0) return "";

  const tail: (string | false)[] = [
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

  const tailParts = tail.filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  return [subject, ...tailParts].join(", ");
}
