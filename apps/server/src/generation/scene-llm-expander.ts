import { createFalClient } from "@fal-ai/client";
import {
  type SonaraSceneState,
  ResolvedSceneCoreSchema,
  type ResolvedSceneCore,
} from "@sonara/shared";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Server-side LLM expander: turns the flat user-facing SonaraSceneState into a
// FLUX.2-style structured ResolvedSceneCore (subjects, palette hex, camera,
// composition, drift candidates). One LLM call per scene-hash; the resolver
// caches the result and reuses it across keyframes.
//
// Uses FAL's `any-llm` endpoint via the shared FAL key (no extra SDK / env).
// Override model with FAL_LLM_MODEL.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 600;

function buildSystemPrompt(): string {
  return `You expand a flat sumi-e music-visualizer scene into a structured FLUX.2 prompt object. Given the user's flat scene fields and slider values, emit a SINGLE JSON object — no prose, no markdown fences. The object MUST match this schema exactly:

{
  "scene": string,                          // 2-5 word title for this look
  "subjects": [                              // 1-3 entries, MOST IMPORTANT first
    { "description": string,                 // 1-8 words; subjects[0] is the identity anchor
      "position"?: string,                   // optional, 1-5 words
      "action"?: string }                    // optional, 1-5 words
  ],
  "style": string,                           // 2-8 words; visual style (sumi-e ink wash, watercolor, oil, etc.)
  "color_palette": [string],                 // 3-5 hex colors as #RRGGBB; MUST cover dark/mid/light range of the user's palette text
  "palette_text": string,                    // echo the user's natural-language palette verbatim when present; "" if the user supplied none
  "lighting": string,                        // 2-8 words
  "mood": string,                            // 2-6 words
  "background": string,                      // 2-10 words; the environment expanded
  "composition": string,                     // 2-8 words; framing & balance
  "camera": {
    "angle": string,                         // 2-5 words (e.g., "low eye-level", "overhead three-quarter")
    "lens": string,                          // 2-5 words (e.g., "50mm normal", "85mm portrait", "24mm wide")
    "depth_of_field": string                 // 2-5 words (e.g., "shallow, soft falloff", "deep focus")
  },
  "drift_candidates": [string]               // 6-10 short atmospheric clauses (1-4 words each); will be sampled across keyframes
}

RULES:
- subjects[0].description MUST closely match the user's "subject" field — same noun, same article. This is the identity anchor; FLUX.2 character consistency depends on it staying byte-stable across keyframes.
- color_palette MUST be hex codes derived from the user's palette text. "iridescent teal and gold" → ["#1A4A45","#5FBFB0","#A0E5DC","#C9A14A","#E5CB7A"] (range from dark to light). If the palette text is empty, infer 3-5 colors from the mood + environment.
- composition + camera should be biased by the SLIDERS:
    - softness > 0.7 → soft falloff DOF, diffuse lighting
    - surrealness > 0.7 → unusual angle, distorted composition
    - abstraction > 0.6 → loose framing, ambiguous boundaries
    - stability < 0.4 → off-balance composition, dutch tilt
- drift_candidates should be evocative ink/paper/light/motion clauses thematically tied to subjects[0] + mood. Vary them — don't repeat words across entries.
- Output ONLY the JSON object. No fences. No commentary.`;
}

function buildUserPrompt(s: SonaraSceneState): string {
  return `Flat scene:
  subject: ${s.subject || "(blank)"}
  environment: ${s.environment || "(blank)"}
  mood: ${s.mood || "(blank)"}
  palette: ${s.palette || "(blank)"}
  style: ${s.style || "(blank)"}
  lighting: ${s.lighting || "(blank)"}
  camera: ${s.camera || "(blank)"}
  action: ${s.action || "(blank)"}

Sliders (0..1):
  intensity: ${s.intensity.toFixed(2)}
  softness: ${s.softness.toFixed(2)}
  surrealness: ${s.surrealness.toFixed(2)}
  abstraction: ${s.abstraction.toFixed(2)}
  stability: ${s.stability.toFixed(2)}

Emit the JSON object.`;
}

interface AnyLlmResult {
  output?: string;
}

function extractOutput(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const r = data as AnyLlmResult;
  if (typeof r.output === "string") return r.output;
  return null;
}

function stripFences(text: string): string {
  let out = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const m = out.match(fence);
  if (m?.[1]) out = m[1].trim();
  return out;
}

// Deterministic fallback used when the LLM errors / returns garbage, AND on
// cold-cache first frames before the background LLM expansion lands. No
// network. The resolver returns this immediately so generation never blocks
// on the expander. Hex palette is intentionally empty — serializer falls back
// to `palette_text` (the user's natural-language palette) for those frames.
//
// Slider-driven style clauses mirror what the legacy `buildPrompt` used to
// append inline — moved here so cold-cache prompts carry the same texture
// signal as the LLM-expanded ones.
export function deterministicResolve(s: SonaraSceneState): ResolvedSceneCore {
  const subject = s.subject?.trim() || "abstract form";
  const compositionParts: string[] = [];
  if (s.surrealness > 0.7) compositionParts.push("surreal fluid composition");
  if (s.abstraction > 0.6) compositionParts.push("dissolving edges");
  if (s.stability < 0.4) compositionParts.push("off-balance, shifting");
  if (compositionParts.length === 0) compositionParts.push("centered traditional");

  const styleParts: string[] = [s.style?.trim() || "sumi-e ink wash"];
  if (s.surrealness > 0.7) styleParts.push("fluid transformations");

  const lightingParts: string[] = [s.lighting?.trim() || "soft ambient"];
  if (s.softness > 0.7) lightingParts.push("diffuse gossamer light");

  const moodParts: string[] = [s.mood?.trim() || "contemplative"];
  if (s.abstraction > 0.6) moodParts.push("luminous ambiguity");

  return {
    scene: subject,
    subjects: [{ description: subject }],
    style: styleParts.join(", "),
    color_palette: [],
    palette_text: s.palette?.trim() ?? "",
    lighting: lightingParts.join(", "),
    mood: moodParts.join(", "),
    background: s.environment?.trim() || "negative space",
    composition: compositionParts.join(", "),
    camera: {
      angle: s.camera?.trim() || "eye level",
      lens: "50mm normal",
      depth_of_field:
        s.softness > 0.7 ? "shallow, soft falloff" : "moderate focus",
    },
    drift_candidates: [],
  };
}

export interface ExpandSceneOpts {
  signal?: AbortSignal;
  logger: Logger;
}

export async function expandScene(
  scene: SonaraSceneState,
  opts: ExpandSceneOpts,
): Promise<ResolvedSceneCore> {
  const model = env.FAL_LLM_MODEL ?? DEFAULT_MODEL;
  const scoped = createFalClient({ credentials: env.FAL_KEY });

  try {
    const result = await scoped.subscribe("fal-ai/any-llm", {
      input: {
        model,
        system_prompt: buildSystemPrompt(),
        prompt: buildUserPrompt(scene),
        max_tokens: MAX_OUTPUT_TOKENS,
        priority: "latency",
      },
      logs: false,
      abortSignal: opts.signal,
    });
    if (opts.signal?.aborted) return deterministicResolve(scene);

    const output = extractOutput(result?.data);
    if (!output) {
      opts.logger.debug({ result }, "scene-expander: empty output");
      return deterministicResolve(scene);
    }

    const stripped = stripFences(output);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      opts.logger.warn(
        { err, output: stripped },
        "scene-expander: JSON parse failed",
      );
      return deterministicResolve(scene);
    }

    const validated = ResolvedSceneCoreSchema.safeParse(parsed);
    if (!validated.success) {
      opts.logger.warn(
        { issues: validated.error.issues, parsed },
        "scene-expander: schema validation failed",
      );
      return deterministicResolve(scene);
    }

    // Subject-anchor invariant guard: if the LLM drifted the first subject
    // away from the user's `subject` field, force it back. FLUX.2 character
    // consistency depends on this byte-stable across keyframes.
    const userSubject = scene.subject.trim();
    if (
      userSubject.length > 0 &&
      validated.data.subjects[0]?.description.trim().toLowerCase() !==
        userSubject.toLowerCase()
    ) {
      opts.logger.debug(
        {
          userSubject,
          llmSubject: validated.data.subjects[0]?.description,
        },
        "scene-expander: anchoring subjects[0] to user subject",
      );
      validated.data.subjects[0] = {
        ...validated.data.subjects[0],
        description: userSubject,
      };
    }

    // Palette-text fallback: if the LLM didn't echo it, copy from the user's
    // input. Load-bearing for the serializer when `color_palette` is empty.
    if (!validated.data.palette_text.trim() && scene.palette?.trim()) {
      validated.data.palette_text = scene.palette.trim();
    }

    return validated.data;
  } catch (err) {
    if (opts.signal?.aborted) return deterministicResolve(scene);
    opts.logger.warn({ err }, "scene-expander: fal any-llm error");
    return deterministicResolve(scene);
  }
}
