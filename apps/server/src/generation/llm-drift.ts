import { fal } from "@fal-ai/client";
import type { Logger } from "../lib/logger";

// Uses fal-ai/any-llm so we stay on one API key (FAL_KEY is already used for
// image generation). The endpoint is marked deprecated in fal's docs but still
// functions as of this writing. If it stops working, rebuild this module
// against the Anthropic SDK (git log around this commit for the original shape).
//
// Default model `google/gemini-2.5-flash-lite` is tiny and fast — our system
// prompt is ~180 tokens and output is ~30, so any lightweight model works.
// Override via FAL_LLM_MODEL env var.
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 80;

const SYSTEM_PROMPT = `You are the atmospheric mind of a sumi-e dream visualizer. Given the current scene (a fixed subject the user has chosen), what the user has been saying out loud, and the mood of the music, emit a short comma-separated list of 1–3 atmospheric clauses that will steer the next AI image generation.

RULES:
- Never name the subject. The subject is the user's anchor.
- Each clause: 2–4 words of atmosphere / texture / light / motion / feeling.
- Total under 12 words.
- Favour sumi-e / washi vocabulary: ink, paper, drift, fog, shadow, light, gesture, silence, stillness, wet, fibres.
- If voice phrases contain nouns, translate to their atmospheric essence ("a crow" → "dark feathered stillness"; "fire" → "ember glow").
- Output only the clauses, comma-separated. No prose, no quotes, no markdown.

GOOD: "ember glow, drifting embers, orange haze"
BAD: "A dragon appears with flames."`;

export interface SynthesizeInput {
  scene: {
    subject: string;
    environment: string;
    mood: string;
    palette: string;
  };
  voicePhrases: string[]; // newest-first, past 30s
  valence: number; // 0..1, bright↔dark
  arousal: number; // 0..1, calm↔energetic
  previousDrift: string | null;
}

export interface SynthesizeOpts {
  signal: AbortSignal;
  logger: Logger;
}

function buildUserPrompt(input: SynthesizeInput): string {
  const voiceList =
    input.voicePhrases.length > 0
      ? input.voicePhrases.map((p) => `  - "${p}"`).join("\n")
      : "  (none)";
  return `Scene:
  subject: ${input.scene.subject || "(blank)"}
  setting: ${input.scene.environment || "(blank)"}
  mood: ${input.scene.mood || "(blank)"}
  palette: ${input.scene.palette || "(blank)"}

What the user has said (newest first, past 30s):
${voiceList}

Music mood:
  valence (bright↔dark): ${input.valence.toFixed(2)}
  arousal (calm↔energetic): ${input.arousal.toFixed(2)}

Previous drift (vary from this): "${input.previousDrift ?? "(none)"}"

Emit new drift.`;
}

// Strips quotes, trailing punctuation, and anything the model may have
// accidentally wrapped around the clauses. Returns null if the result is empty.
function sanitize(text: string): string | null {
  let out = text.trim();
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  out = out.replace(/\.+$/, "").trim();
  return out.length > 0 ? out : null;
}

interface AnyLlmResult {
  output?: string;
  error?: string;
}

function extractOutput(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const result = data as AnyLlmResult;
  if (typeof result.output === "string") return result.output;
  return null;
}

let _warnedNoKey = false;

export async function synthesizeDrift(
  input: SynthesizeInput,
  opts: SynthesizeOpts,
): Promise<string | null> {
  if (!process.env.FAL_KEY) {
    if (!_warnedNoKey) {
      _warnedNoKey = true;
      opts.logger.warn(
        "FAL_KEY not set — LLM drift synthesis disabled, falling back to voice phrases and static pool",
      );
    }
    return null;
  }

  const model = process.env.FAL_LLM_MODEL ?? DEFAULT_MODEL;

  try {
    const result = await fal.subscribe("fal-ai/any-llm", {
      input: {
        model,
        system_prompt: SYSTEM_PROMPT,
        prompt: buildUserPrompt(input),
        max_tokens: MAX_OUTPUT_TOKENS,
        priority: "latency",
      },
      logs: false,
      abortSignal: opts.signal,
    });
    if (opts.signal.aborted) return null;

    const output = extractOutput(result?.data);
    if (!output) {
      opts.logger.debug({ result }, "llm drift: empty output");
      return null;
    }
    return sanitize(output);
  } catch (err) {
    if (opts.signal.aborted) return null;
    opts.logger.warn({ err }, "llm drift: fal any-llm error");
    return null;
  }
}
