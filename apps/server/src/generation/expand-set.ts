import { createFalClient } from "@fal-ai/client";
import {
  VISUAL_PRESET_DESCRIPTIONS,
  VISUAL_PRESET_NAMES,
} from "@sonara/shared";
import { z } from "zod";

import { env } from "../env";
import type { Logger } from "../lib/logger";

// Server-side LLM expander for the "generate a set with AI" feature. Turns a
// user's free-text description + a frame count into a coherent SetSpec — one
// locked visual "world" plus N palette-anchored t2i prompts — mirroring the
// deck-authoring recipe Brenda used by hand (one palette/aesthetic obeyed by
// every frame; per-prompt anatomy: subject · palette tokens (repeated) · mood
// · render hint). The repeated palette tokens are the coherence glue.
//
// Same transport + JSON-discipline as scene-llm-expander.ts: Gemini directly
// when GEMINI_API_KEY is set, else FAL any-llm (zero-config, needs only
// FAL_KEY); strip fences → JSON.parse → zod-validate → deterministic fallback
// so generation never hard-fails on an off-spec model.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
// Larger budget than the per-scene expander — a set is N prompts in one shot.
const MAX_OUTPUT_TOKENS = 2000;

export interface SetSpec {
  // 2-5 word library title for the set.
  name: string;
  // One-line style/world anchor (the deckStyle successor — becomes styleDrift).
  style: string;
  look: {
    preset: (typeof VISUAL_PRESET_NAMES)[number];
    intensity: number;
    cadence: { calm: number; loud: number };
  };
  // Exactly `count` self-contained t2i prompts, each obeying the world anchor.
  prompts: string[];
}

const PRESET_MENU = VISUAL_PRESET_NAMES.map(
  (name) => `    ${name} — ${VISUAL_PRESET_DESCRIPTIONS[name]}`
).join("\n");

const buildSystemPrompt = (count: number): string =>
  `You design a coherent SET of ${count} visuals for a music-reactive concert screen, from a one-line description. A set is ONE visual "world": a single locked palette + aesthetic that EVERY frame obeys, so the screen reads as one show, not ${count} unrelated images.

Emit a SINGLE JSON object — no prose, no markdown fences — matching this schema EXACTLY:

{
  "name": string,                 // 2-5 word title for the set
  "style": string,                // ONE line: the world's locked aesthetic + palette (e.g. "misty jade-and-gold sumi-e ink wash, long-exposure river light")
  "look": {
    "preset": string,             // EXACTLY one key from the PRESETS menu below
    "intensity": number,          // 0..1 how hard the visuals react to the beat (calm world ~0.3, rave ~0.85)
    "cadence": { "calm": number, "loud": number }  // ms between frame changes at calm vs loud passages; calm > loud; both 200..8000
  },
  "prompts": [string]             // EXACTLY ${count} entries
}

PROMPT ANATOMY — every entry MUST follow this shape so the set stays coherent:
  [concrete subject/scene] · [the SAME palette tokens from "style", repeated verbatim] · [mood tokens] · [render hint]
- The repeated palette tokens are the coherence glue — echo them in EVERY prompt, near-identically.
- The render hint is one of: cinematic, macro, long exposure, ink wash, soft focus, backlit, aerial, etc.
- Vary the SUBJECT and CAMERA ANGLE across the ${count} prompts (wide → detail → overhead → silhouette …) but NEVER the palette or aesthetic.
- Each prompt is self-contained (independent text-to-image — no "same as before", no frame numbers).
- 12-30 words each. No camera brand names, no text/letters in the image, no real public figures.

PRESETS (pick the ONE that best fits the world's mood):
${PRESET_MENU}

SAFETY: this is a PUBLIC venue screen. Keep every prompt appropriate — no sexual content, gore, hate, or anything sexualizing minors. Avoid words that trip image moderation; if the description is edgy, render its mood abstractly. Do NOT invent capabilities (no audio, no video, no interactivity) — just still-image prompts.

Output ONLY the JSON object.`;

const buildUserPrompt = (description: string, count: number): string =>
  `Description: "${description.trim()}"

Design the set: pick the palette + aesthetic, choose a fitting preset/intensity/cadence, and write EXACTLY ${count} prompts that all obey that one world. Emit the JSON object.`;

interface AnyLlmResult {
  output?: string;
}

const extractOutput = (data: unknown): string | null => {
  if (!data || typeof data !== "object") {
    return null;
  }
  const r = data as AnyLlmResult;
  return typeof r.output === "string" ? r.output : null;
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
        temperature: 0.9,
      },
      systemInstruction: { parts: [{ text: system }] },
    }),
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

// Validation: preset must be a real key; counts clamp; prompts must number
// exactly `count` (we pad/trim defensively below before this runs).
const SetSpecSchema = z.object({
  look: z.object({
    cadence: z.object({
      calm: z.number().int().min(200).max(8000),
      loud: z.number().int().min(200).max(8000),
    }),
    intensity: z.number().min(0).max(1),
    preset: z.enum(VISUAL_PRESET_NAMES),
  }),
  name: z.string().trim().min(1).max(80),
  prompts: z.array(z.string().trim().min(1)).min(1),
  style: z.string().trim().min(1).max(300),
});

// Deterministic fallback — a neutral, always-valid world built from the raw
// description. Used when the LLM errors / returns garbage so a generate
// request never hard-fails; the resulting set is plain but coherent.
const deterministicSet = (description: string, count: number): SetSpec => {
  const subject = description.trim() || "abstract sumi-e forms";
  const style = `${subject}, ethereal sumi-e ink wash, indigo and pale gold, soft mist`;
  const angles = [
    "wide establishing view",
    "intimate macro detail",
    "overhead aerial",
    "low backlit silhouette",
    "drifting close-up",
  ];
  const prompts = Array.from({ length: count }, (_v, i) => {
    const angle = angles[i % angles.length];
    return `${subject}, ${angle}, indigo and pale gold palette, soft mist, contemplative mood, ink wash`;
  });
  return {
    look: {
      cadence: { calm: 2600, loud: 900 },
      intensity: 0.4,
      preset: "wet_ink",
    },
    name: subject.split(/\s+/u).slice(0, 4).join(" "),
    prompts,
    style,
  };
};

// Force the prompts array to exactly `count` so downstream billing/looping is
// predictable even when the model returns N±k. Pads by cycling, trims excess.
const fitToCount = (prompts: string[], count: number): string[] => {
  if (prompts.length === count) {
    return prompts;
  }
  if (prompts.length > count) {
    return prompts.slice(0, count);
  }
  const out = [...prompts];
  let i = 0;
  while (out.length < count && prompts.length > 0) {
    out.push(prompts[i % prompts.length] as string);
    i += 1;
  }
  return out;
};

export interface ExpandSetInput {
  description: string;
  count: number;
  signal?: AbortSignal;
  logger: Logger;
}

export const expandSet = async (input: ExpandSetInput): Promise<SetSpec> => {
  const { count, description, logger, signal } = input;
  const system = buildSystemPrompt(count);
  const user = buildUserPrompt(description, count);
  const apiKey = env.GEMINI_API_KEY;
  const useGemini = apiKey !== undefined && apiKey.length > 0;

  try {
    const output = useGemini
      ? await callGemini(apiKey, system, user, signal)
      : await callFalAnyLlm(system, user, signal);
    if (signal?.aborted) {
      return deterministicSet(description, count);
    }
    if (output === null || output.length === 0) {
      logger.debug({ useGemini }, "expand-set: empty LLM output");
      return deterministicSet(description, count);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(output));
    } catch (error) {
      logger.warn({ error }, "expand-set: JSON parse failed");
      return deterministicSet(description, count);
    }

    const validated = SetSpecSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn(
        { issues: validated.error.issues },
        "expand-set: schema validation failed"
      );
      return deterministicSet(description, count);
    }

    const spec = validated.data;
    // calm must be the slower cadence; swap if the model inverted them.
    const calm = Math.max(spec.look.cadence.calm, spec.look.cadence.loud);
    const loud = Math.min(spec.look.cadence.calm, spec.look.cadence.loud);
    return {
      look: {
        cadence: { calm, loud },
        intensity: spec.look.intensity,
        preset: spec.look.preset,
      },
      name: spec.name,
      prompts: fitToCount(spec.prompts, count),
      style: spec.style,
    };
  } catch (error) {
    if (signal?.aborted) {
      return deterministicSet(description, count);
    }
    logger.warn({ error }, "expand-set: LLM error");
    return deterministicSet(description, count);
  }
};
