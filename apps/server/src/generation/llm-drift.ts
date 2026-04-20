import { fal } from "@fal-ai/client";
import type { Logger } from "../lib/logger";

// Uses fal-ai/any-llm so we stay on one API key (FAL_KEY is already used for
// image generation). The endpoint is flagged deprecated in fal's docs but
// still functions as of writing; rebuild against Anthropic if it stops.
const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 160;

// Known preset names mirror the client's PRESETS registry. Kept here as a
// simple constant so we don't pull in a client dep on the server.
const PRESET_NAMES = [
  "wet_ink",
  "ember",
  "frost",
  "mandala",
  "dust",
  "storm",
  "silent_film",
  "neon_line",
] as const;
type PresetName = (typeof PRESET_NAMES)[number];
function isPresetName(x: unknown): x is PresetName {
  return typeof x === "string" && (PRESET_NAMES as readonly string[]).includes(x);
}

const PRESET_DESCRIPTIONS: Record<PresetName, string> = {
  wet_ink: "balanced sumi-e baseline",
  ember: "burnt orange volcanic glow",
  frost: "cool minimal cold edges",
  mandala: "kaleidoscopic radial symmetry",
  dust: "grainy slow-motion soft",
  storm: "aggressive gritty swirling",
  silent_film: "duotone sepia flickering posterize",
  neon_line: "stark signal/indigo edges maximum",
};

// JSON-output prompt. The LLM returns {drift, preset?}. If we ever lose
// structured-output reliability we'll fall back to regex extraction.
const SYSTEM_PROMPT = `You are the atmospheric mind of a sumi-e dream visualizer. Given the current scene, what the user has been saying, and the music's mood, emit:
  1. A short "drift" — a comma-separated list of 1–3 atmospheric clauses (2–4 words each, under 12 words total) that steer the next AI image. Never name the subject. Favour ink/paper/fog/light/gesture/stillness vocabulary. Translate any spoken nouns to their atmospheric essence.
  2. Optionally a "preset" — the visual look that best matches the current energy, drawn from this list:

${PRESET_NAMES.map((n) => `  - ${n}: ${PRESET_DESCRIPTIONS[n]}`).join("\n")}

Only suggest a preset when the scene/voice/mood genuinely changed — don't re-suggest the same preset over and over. Omit preset if no switch is warranted.

Respond with STRICT JSON:
{"drift": "<clauses>", "preset": "<one of the preset names>" | null}

GOOD: {"drift": "ember glow, drifting embers, orange haze", "preset": "ember"}
GOOD: {"drift": "pale mist, silent fibres, held breath", "preset": null}
BAD:  prose, markdown, extra keys, quoted preset name outside the enum`;

export interface SynthesizeInput {
  scene: {
    subject: string;
    environment: string;
    mood: string;
    palette: string;
  };
  voicePhrases: string[];
  valence: number;
  arousal: number;
  previousDrift: string | null;
  previousPreset: string | null;
}

export interface SynthesizeResult {
  drift: string | null;
  preset: PresetName | null;
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
Previous preset: "${input.previousPreset ?? "(none)"}"

Emit JSON only.`;
}

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

// Parses the LLM output. Prefers strict JSON. Falls back to regex-extraction
// if the model returns prose around the JSON (still pretty common with small
// models). If all parsing fails, returns the raw string as drift.
function parseResult(raw: string): SynthesizeResult {
  const trimmed = raw.trim();
  // Strip ```json fences if the model emitted markdown.
  const noFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  // Try strict JSON first.
  try {
    const obj = JSON.parse(noFence) as unknown;
    if (obj && typeof obj === "object") {
      const o = obj as { drift?: unknown; preset?: unknown };
      const drift = typeof o.drift === "string" ? sanitize(o.drift) : null;
      const preset = isPresetName(o.preset) ? o.preset : null;
      return { drift, preset };
    }
  } catch {
    /* fall through */
  }
  // Regex: find a JSON-ish object anywhere in the response.
  const match = noFence.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]) as unknown;
      if (obj && typeof obj === "object") {
        const o = obj as { drift?: unknown; preset?: unknown };
        const drift = typeof o.drift === "string" ? sanitize(o.drift) : null;
        const preset = isPresetName(o.preset) ? o.preset : null;
        return { drift, preset };
      }
    } catch {
      /* fall through */
    }
  }
  // Last resort: whole response as drift, no preset.
  return { drift: sanitize(noFence), preset: null };
}

let _warnedNoKey = false;

export async function synthesizeDrift(
  input: SynthesizeInput,
  opts: SynthesizeOpts,
): Promise<SynthesizeResult> {
  if (!process.env.FAL_KEY) {
    if (!_warnedNoKey) {
      _warnedNoKey = true;
      opts.logger.warn(
        "FAL_KEY not set — LLM drift synthesis disabled, falling back to voice phrases and static pool",
      );
    }
    return { drift: null, preset: null };
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
    if (opts.signal.aborted) return { drift: null, preset: null };

    const output = extractOutput(result?.data);
    if (!output) {
      opts.logger.debug({ result }, "llm drift: empty output");
      return { drift: null, preset: null };
    }
    return parseResult(output);
  } catch (err) {
    if (opts.signal.aborted) return { drift: null, preset: null };
    opts.logger.warn({ err }, "llm drift: fal any-llm error");
    return { drift: null, preset: null };
  }
}
