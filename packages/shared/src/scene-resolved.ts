import { z } from "zod";

// ResolvedScene is the structured intermediate the server derives from the
// flat user-facing SonaraSceneState before serialising to a FLUX.2 prompt.
// FLUX.2 itself takes a string; the JSON layer exists for (a) richer prompt
// structure per BFL's prompting guide, (b) hex-palette extraction we can feed
// back to the renderer, and (c) observability — the inspector HUD shows the
// resolved JSON next to the final prompt.
//
// Lives in shared because it is shipped over the WS event stream
// (generation.requested) so the client can render it.

const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/u, "expected #RRGGBB hex");

export const ResolvedSubjectSchema = z.object({
  action: z.string().optional(),
  description: z.string().min(1),
  position: z.string().optional(),
});

export const ResolvedCameraSchema = z.object({
  angle: z.string(),
  depth_of_field: z.string(),
  lens: z.string(),
});

export const ResolvedAudioStateSchema = z.object({
  energyDelta: z.number(),
  intensity: z.number().min(0).max(1),
  section: z.number(),
});

// Core = everything the LLM expander emits. Cached server-side by scene-hash
// so it is reused across periodic/pause triggers without re-calling the LLM.
export const ResolvedSceneCoreSchema = z.object({
  background: z.string(),
  camera: ResolvedCameraSchema,
  color_palette: z.array(HexColor),
  composition: z.string(),
  drift_candidates: z.array(z.string()),
  lighting: z.string(),
  mood: z.string(),
  // Natural-language palette text from the user (e.g. "iridescent pastels").
  // Always-populated fallback for the serializer: used when color_palette is
  // empty (cold-cache / LLM failure) so the prompt never loses palette signal.
  palette_text: z.string().default(""),
  scene: z.string(),
  style: z.string(),
  subjects: z.array(ResolvedSubjectSchema).min(1),
});

// Full resolved scene = core + per-trigger drift selection + audio snapshot.
// `drift_modifiers` are the 1–3 clauses chosen for THIS trigger;
// `audio_state` is HUD-only and never serialised into the FAL prompt.
export const ResolvedScene = ResolvedSceneCoreSchema.extend({
  audio_state: ResolvedAudioStateSchema,
  drift_modifiers: z.array(z.string()),
});

export type ResolvedSubject = z.infer<typeof ResolvedSubjectSchema>;
export type ResolvedCamera = z.infer<typeof ResolvedCameraSchema>;
export type ResolvedAudioState = z.infer<typeof ResolvedAudioStateSchema>;
export type ResolvedSceneCore = z.infer<typeof ResolvedSceneCoreSchema>;
export type ResolvedScene = z.infer<typeof ResolvedScene>;
