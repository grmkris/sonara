import { createFalClient } from "@fal-ai/client";
import {
  type SonaraSceneState,
  ResolvedSceneCoreSchema,
  type ResolvedSceneCore,
} from "@sonara/shared";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Server-side LLM expander: parses the user's flat prompt string + slider
// values into a FLUX.2-style structured ResolvedSceneCore (subjects, palette
// hex, camera, composition, drift candidates). One LLM call per prompt hash;
// the resolver caches the result and reuses it across keyframes.
//
// Uses FAL's `any-llm` endpoint via the shared FAL key (no extra SDK / env).
// Override model with FAL_LLM_MODEL.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 600;

function buildSystemPrompt(): string {
  return `You parse a single user-written prompt sentence into a structured FLUX.2 prompt object. Given the user's prompt and 5 slider values, emit a SINGLE JSON object — no prose, no markdown fences. The object MUST match this schema exactly:

{
  "scene": string,                          // 2-5 word title for this look
  "subjects": [                              // 1-3 entries, MOST IMPORTANT first
    { "description": string,                 // 1-8 words; subjects[0] is the identity anchor
      "position"?: string,                   // optional, 1-5 words
      "action"?: string }                    // optional, 1-5 words
  ],
  "style": string,                           // 2-8 words; visual style (sumi-e ink wash, watercolor, oil, etc.)
  "color_palette": [string],                 // 3-5 hex colors as #RRGGBB; MUST cover dark/mid/light range
  "palette_text": string,                    // echo any colour words from the user's prompt verbatim; "" if none
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
- Extract whatever the user's prompt names: subject, environment, mood, palette, style. Fill the rest from context.
- subjects[0].description MUST be the most prominent noun phrase from the user's prompt — keep it byte-stable so FLUX.2 character consistency holds across keyframes. Strip articles only if it improves readability.
- background: the locative clue from the prompt expanded. If the prompt is subject-only, choose "negative space" or a minimal complement to the subject.
- color_palette MUST be 3-5 hex codes spanning dark-to-light. If the user named colours, derive the palette from those. If not, infer from mood + subject.
- palette_text: echo the user's colour words verbatim ("indigo and silver", "moss green and dappled gold"); "" if the prompt names no colours.
- composition + camera should be biased by the SLIDERS:
    - softness > 0.7 → soft falloff DOF, diffuse lighting
    - surrealness > 0.7 → unusual angle, distorted composition
    - abstraction > 0.6 → loose framing, ambiguous boundaries
    - stability < 0.4 → off-balance composition, dutch tilt
- drift_candidates: evocative ink/paper/light/motion clauses thematically tied to subjects[0] + mood. Vary them — don't repeat words across entries.
- Stay sumi-e / ethereal / dreamlike unless the user's prompt explicitly names a different register.
- Output ONLY the JSON object. No fences. No commentary.`;
}

function buildUserPrompt(s: SonaraSceneState): string {
  const prompt = s.prompt.trim();
  return `User prompt: ${prompt.length > 0 ? `"${prompt}"` : "(blank)"}

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

// Heuristic anchor extraction: take the first ~5 words of the prompt as the
// stand-in subject. Used for the deterministic fallback when the LLM hasn't
// expanded yet (cold cache or error path). The LLM rewrites `subjects[0]`
// with a better choice on its hot-path completion.
function anchorFromPrompt(prompt: string): string {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return "abstract form";
  const words = trimmed.split(/\s+/);
  return words.slice(0, 5).join(" ");
}

// Deterministic fallback used when the LLM errors / returns garbage, AND on
// cold-cache first frames before the background LLM expansion lands. No
// network. The resolver returns this immediately so generation never blocks
// on the expander. Hex palette is intentionally empty — serializer falls back
// to `palette_text` (which is also empty here; the user's raw prompt carries
// the palette signal directly in this case).
export function deterministicResolve(s: SonaraSceneState): ResolvedSceneCore {
  const anchor = anchorFromPrompt(s.prompt);
  const compositionParts: string[] = [];
  if (s.surrealness > 0.7) compositionParts.push("surreal fluid composition");
  if (s.abstraction > 0.6) compositionParts.push("dissolving edges");
  if (s.stability < 0.4) compositionParts.push("off-balance, shifting");
  if (compositionParts.length === 0) compositionParts.push("centered traditional");

  const styleParts: string[] = ["sumi-e ink wash"];
  if (s.surrealness > 0.7) styleParts.push("fluid transformations");

  const lightingParts: string[] = ["soft ambient"];
  if (s.softness > 0.7) lightingParts.push("diffuse gossamer light");

  const moodParts: string[] = ["contemplative"];
  if (s.abstraction > 0.6) moodParts.push("luminous ambiguity");

  return {
    scene: anchor,
    subjects: [{ description: anchor }],
    style: styleParts.join(", "),
    color_palette: [],
    palette_text: "",
    lighting: lightingParts.join(", "),
    mood: moodParts.join(", "),
    background: "negative space",
    composition: compositionParts.join(", "),
    camera: {
      angle: "eye level",
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

    return validated.data;
  } catch (err) {
    if (opts.signal?.aborted) return deterministicResolve(scene);
    opts.logger.warn({ err }, "scene-expander: fal any-llm error");
    return deterministicResolve(scene);
  }
}
