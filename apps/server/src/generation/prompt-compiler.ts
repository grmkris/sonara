import type { ResolvedScene } from "@sonara/shared";

// Serialise a structured ResolvedScene to a FLUX.2-friendly prompt string.
// This is the single prompt path — FAL receives exactly what this returns.
//
// Subject-anchor invariant
// ------------------------
// `subjects[0].description` is the identity anchor and ALWAYS goes first,
// byte-identical across keyframes, never modulated by audio or reordered.
// FLUX.2 klein's character consistency depends on this stable leading phrase.
// The LLM expander guards it (see `scene-llm-expander.ts`); keep that guard
// in sync if this emission shape ever changes.
//
// Palette emission
// ----------------
// Prefer hex codes from `color_palette` (LLM-expanded, sub-frame precision).
// Fall back to `palette_text` (natural-language, always populated) so
// cold-cache frames never lose palette signal. Omit the clause entirely if
// both are empty.
//
// drift_modifiers go last so each keyframe can vary them without disturbing
// earlier slots.
// oxlint-disable-next-line complexity -- REVIEW: straight-line prompt assembly with many optional clauses; extracting helpers would obscure the fixed slot order that FLUX.2 depends on
export const serializeResolvedScene = (rs: ResolvedScene): string => {
  const subject = rs.subjects[0]?.description.trim() ?? "";
  if (subject.length === 0) {
    return "";
  }

  const tail: string[] = [];

  // Additional subjects (1..n) with optional position/action.
  for (let i = 1; i < rs.subjects.length; i += 1) {
    const s = rs.subjects[i];
    if (!s) {
      continue;
    }
    const parts = [s.description.trim()];
    if (s.position?.trim()) {
      parts.push(s.position.trim());
    }
    if (s.action?.trim()) {
      parts.push(s.action.trim());
    }
    tail.push(parts.join(" "));
  }

  if (rs.composition.trim()) {
    tail.push(rs.composition.trim());
  }
  if (rs.style.trim()) {
    tail.push(rs.style.trim());
  }
  if (rs.background.trim()) {
    tail.push(rs.background.trim());
  }
  if (rs.lighting.trim()) {
    tail.push(rs.lighting.trim());
  }

  const camParts = [
    rs.camera.angle.trim(),
    rs.camera.lens.trim(),
    rs.camera.depth_of_field.trim(),
  ].filter((p) => p.length > 0);
  if (camParts.length > 0) {
    tail.push(camParts.join(", "));
  }

  if (rs.mood.trim()) {
    tail.push(rs.mood.trim());
  }

  if (rs.color_palette.length > 0) {
    tail.push(`palette: ${rs.color_palette.join(", ")}`);
  } else {
    // `?? ""` tolerates stale hot-reloaded cache entries that pre-date the
    // `palette_text` field addition. Zod `.default("")` handles fresh-parsed
    // objects, but in-memory caches bypass validation.
    const paletteText = (rs.palette_text ?? "").trim();
    if (paletteText.length > 0) {
      tail.push(`palette: ${paletteText}`);
    }
  }

  for (const mod of rs.drift_modifiers) {
    const m = mod.trim();
    if (m.length > 0) {
      tail.push(m);
    }
  }

  return [subject, ...tail].join(", ");
};
