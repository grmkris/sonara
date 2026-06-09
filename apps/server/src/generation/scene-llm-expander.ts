import { createFalClient } from "@fal-ai/client";
import { ResolvedSceneCoreSchema } from "@sonara/shared";
import type { SonaraSceneState, ResolvedSceneCore } from "@sonara/shared";

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

// Used ONLY when the moderator flags a prompt unsafe but returns a malformed
// scene object (rare) — a neutral SFW stand-in so we never fall through to the
// raw prompt. One constant, not a content list.
const DENIAL_FALLBACK_PROMPT =
  "a friendly cartoon mascot holding a playful 'let's keep it PG' sign";

const buildSystemPrompt = (): string =>
  `You parse a single user-written prompt sentence into a structured FLUX.2 prompt object. Given the user's prompt and 5 slider values, emit a SINGLE JSON object — no prose, no markdown fences. The object MUST match this schema exactly:

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
  "drift_candidates": [string],              // 6-10 short atmospheric clauses (1-4 words each); will be sampled across keyframes
  "safe": boolean                            // false ONLY if the prompt is inappropriate for a PUBLIC venue screen (see SAFETY)
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
- SAFETY (single pass — you are ALSO the moderator): judge if the prompt is appropriate for a PUBLIC venue screen. Set "safe": true for normal, artistic, abstract, or mildly edgy prompts. Set "safe": false ONLY for sexually explicit content, graphic violence/gore, hateful/harassing content, or anything sexualizing minors. When "safe" is false, DO NOT depict the request — instead fill ALL scene fields with a light-hearted, crowd-friendly SFW "request denied" visual of your OWN invention (e.g. a comedic bouncer at a velvet rope, a shrugging mascot with a "nope" sign, a googly-eyed robot holding STOP). Still emit a complete, valid object.
- Output ONLY the JSON object. No fences. No commentary.`;

const buildUserPrompt = (s: SonaraSceneState): string => {
  const prompt = s.prompt.trim();
  return `User prompt: ${prompt.length > 0 ? `"${prompt}"` : "(blank)"}

Sliders (0..1):
  intensity: ${s.intensity.toFixed(2)}
  softness: ${s.softness.toFixed(2)}
  surrealness: ${s.surrealness.toFixed(2)}
  abstraction: ${s.abstraction.toFixed(2)}
  stability: ${s.stability.toFixed(2)}

Emit the JSON object.`;
};

interface AnyLlmResult {
  output?: string;
}

const extractOutput = (data: unknown): string | null => {
  if (!data || typeof data !== "object") {
    return null;
  }
  const r = data as AnyLlmResult;
  if (typeof r.output === "string") {
    return r.output;
  }
  return null;
};

const stripFences = (text: string): string => {
  let out = text.trim();
  const fence = /^```(?:json)?\s*\n?(?<body>[\s\S]*?)\n?```$/u;
  const m = out.match(fence);
  const body = m?.groups?.body;
  if (body !== undefined && body.length > 0) {
    out = body.trim();
  }
  return out;
};

// Heuristic anchor extraction: take the first ~5 words of the prompt as the
// stand-in subject. Used for the deterministic fallback when the LLM hasn't
// expanded yet (cold cache or error path). The LLM rewrites `subjects[0]`
// with a better choice on its hot-path completion.
const anchorFromPrompt = (prompt: string): string => {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) {
    return "abstract form";
  }
  const words = trimmed.split(/\s+/u);
  return words.slice(0, 5).join(" ");
};

// Deterministic fallback used when the LLM errors / returns garbage, AND on
// cold-cache first frames before the background LLM expansion lands. No
// network. The resolver returns this immediately so generation never blocks
// on the expander. Hex palette is intentionally empty — serializer falls back
// to `palette_text` (which is also empty here; the user's raw prompt carries
// the palette signal directly in this case).
export const deterministicResolve = (
  s: SonaraSceneState
): ResolvedSceneCore => {
  const anchor = anchorFromPrompt(s.prompt);
  const compositionParts: string[] = [];
  if (s.surrealness > 0.7) {
    compositionParts.push("surreal fluid composition");
  }
  if (s.abstraction > 0.6) {
    compositionParts.push("dissolving edges");
  }
  if (s.stability < 0.4) {
    compositionParts.push("off-balance, shifting");
  }
  if (compositionParts.length === 0) {
    compositionParts.push("centered traditional");
  }

  const styleParts: string[] = ["sumi-e ink wash"];
  if (s.surrealness > 0.7) {
    styleParts.push("fluid transformations");
  }

  const lightingParts: string[] = ["soft ambient"];
  if (s.softness > 0.7) {
    lightingParts.push("diffuse gossamer light");
  }

  const moodParts: string[] = ["contemplative"];
  if (s.abstraction > 0.6) {
    moodParts.push("luminous ambiguity");
  }

  return {
    background: "negative space",
    camera: {
      angle: "eye level",
      depth_of_field:
        s.softness > 0.7 ? "shallow, soft falloff" : "moderate focus",
      lens: "50mm normal",
    },
    color_palette: [],
    composition: compositionParts.join(", "),
    drift_candidates: [],
    lighting: lightingParts.join(", "),
    mood: moodParts.join(", "),
    palette_text: "",
    scene: anchor,
    style: styleParts.join(", "),
    subjects: [{ description: anchor }],
  };
};

export interface ExpandSceneOpts {
  signal?: AbortSignal;
  logger: Logger;
}

// Pull the text payload out of a Gemini generateContent response.
const extractGeminiText = (data: unknown): string | null => {
  if (data === null || typeof data !== "object") {
    return null;
  }
  const { candidates } = data as { candidates?: unknown };
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content
    ?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    return null;
  }
  const { text } = parts[0] as { text?: unknown };
  return typeof text === "string" ? text : null;
};

// Direct Google Gemini call — bypasses fal any-llm's ~1.5-2s queue overhead.
// responseMimeType JSON forces a bare JSON object (no markdown fences).
const callGemini = async (
  apiKey: string,
  system: string,
  user: string,
  signal: AbortSignal | undefined
): Promise<string | null> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    body: JSON.stringify({
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        responseMimeType: "application/json",
        temperature: 0.8,
      },
      systemInstruction: { parts: [{ text: system }] },
    }),
    // This key authenticates via the header, not a ?key= query param.
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    method: "POST",
    signal,
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`gemini ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const json = await res.json();
  return extractGeminiText(json);
};

// FAL any-llm fallback (the original transport). Used when GEMINI_API_KEY is
// unset. Carries the queue overhead; kept for zero-config deploys.
const callFalAnyLlm = async (
  system: string,
  user: string,
  signal: AbortSignal | undefined
): Promise<string | null> => {
  const model = env.FAL_LLM_MODEL ?? DEFAULT_MODEL;
  const scoped = createFalClient({ credentials: env.FAL_KEY });
  const result = await scoped.subscribe("fal-ai/any-llm", {
    abortSignal: signal,
    input: {
      max_tokens: MAX_OUTPUT_TOKENS,
      model,
      priority: "latency",
      prompt: user,
      system_prompt: system,
    },
    logs: false,
  });
  return extractOutput(result?.data);
};

export const expandScene = async (
  scene: SonaraSceneState,
  opts: ExpandSceneOpts
): Promise<ResolvedSceneCore> => {
  const system = buildSystemPrompt();
  const user = buildUserPrompt(scene);
  const apiKey = env.GEMINI_API_KEY;
  const useGemini = apiKey !== undefined && apiKey.length > 0;

  try {
    const output = useGemini
      ? await callGemini(apiKey, system, user, opts.signal)
      : await callFalAnyLlm(system, user, opts.signal);
    if (opts.signal?.aborted) {
      return deterministicResolve(scene);
    }

    if (output === null || output.length === 0) {
      opts.logger.debug({ useGemini }, "scene-expander: empty LLM output");
      return deterministicResolve(scene);
    }

    const stripped = stripFences(output);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (error) {
      opts.logger.warn(
        { error, output: stripped },
        "scene-expander: JSON parse failed"
      );
      return deterministicResolve(scene);
    }

    // Single-pass moderation: the LLM sets `safe:false` and authors its own
    // funny SFW denial scene in the SAME object, so when unsafe we still just
    // render `validated.data` (the LLM's denial) — `safe` is for logging.
    const flaggedUnsafe =
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { safe?: unknown }).safe === false;

    const validated = ResolvedSceneCoreSchema.safeParse(parsed);
    if (!validated.success) {
      opts.logger.warn(
        { issues: validated.error.issues, parsed },
        "scene-expander: schema validation failed"
      );
      // If flagged unsafe but the object was malformed, never fall through to
      // the raw prompt — seed the deterministic stand-in with a neutral phrase.
      return flaggedUnsafe
        ? deterministicResolve({ ...scene, prompt: DENIAL_FALLBACK_PROMPT })
        : deterministicResolve(scene);
    }

    if (flaggedUnsafe) {
      opts.logger.info(
        { prompt: scene.prompt },
        "scene-expander: prompt flagged unsafe — rendering LLM denial scene"
      );
    }

    return validated.data;
  } catch (error) {
    if (opts.signal?.aborted) {
      return deterministicResolve(scene);
    }
    opts.logger.warn({ error }, "scene-expander: LLM error");
    return deterministicResolve(scene);
  }
};
