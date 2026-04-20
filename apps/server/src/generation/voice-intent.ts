import { fal } from "@fal-ai/client";
import {
  SCENE_TEMPLATE_KEYS,
  VISUAL_PRESET_DESCRIPTIONS,
  VISUAL_PRESET_NAMES,
  type VisualPresetName,
} from "@music-visualizer/shared";
import type { Logger } from "../lib/logger";
import { sampleDrift } from "./prompt-drift";

// Voice-intent parser.
//
// Replaces the old llm-drift synthesizer. The LLM now does TWO jobs in one
// call: (1) parse the user's spoken phrase into a structured scene intent
// (subject / environment / mood / palette / intensity / commit / reset /
// preset), and (2) emit an atmospheric drift clause informed by the scene and
// music mood. Structural intent drives immediate regeneration; atmosphere
// flavors subsequent frames.
//
// Endpoint: fal-ai/any-llm (default google/gemini-2.5-flash-lite). One API key
// shared with image generation. Override model via FAL_LLM_MODEL.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 240;

function buildSystemPrompt(): string {
  const presetList = SCENE_TEMPLATE_KEYS.join(", ");
  const lookList = VISUAL_PRESET_NAMES
    .map((n) => `${n} (${VISUAL_PRESET_DESCRIPTIONS[n]})`)
    .join("; ");
  return `You parse spoken phrases from a user operating a sumi-e dream visualizer. Given the user's voice, the current scene, recent voice history, and the music mood, emit a SINGLE JSON object. No prose, no markdown fences, no commentary. The object MUST have exactly these keys (any value may be null):

{
  "patch": { "subject"?: string, "environment"?: string, "mood"?: string, "palette"?: string, "intensity"?: number },
  "commit": boolean,
  "reset": boolean,
  "preset": string | null,
  "lookPreset": string | null,
  "atmosphere": string | null
}

RULES:
- Only fill patch fields the user CLEARLY intended. If ambiguous, omit.
- subject = concrete visual subject (1–8 words). A phrase like "a crow" is a subject, not atmosphere.
- environment = setting/place (1–10 words).
- mood = emotional register (1–6 words). "make it colder" is a mood change.
- palette = comma-joined color adjectives (1–8 words). "rust and bone" is a palette.
- intensity = absolute 0..1. Map relative words given current intensity:
    "pull it back" / "calmer" / "quieter" / "slower" → current − 0.3 (clamp to 0)
    "more" / "crank it" / "intense" / "faster" → current + 0.3 (clamp to 1)
    "intensity 0.7" / "seventy percent" → 0.7
- commit verbs (return commit: true): commit / save this / keep it / keep this / lock it / hold this.
- reset verbs (return reset: true): reset / start over / clear / forget this / new scene.
- preset verbs (return preset: "<key>"): "preset <key>" / "try the <key> one" / "load <key>". Valid scene keys: ${presetList}.
- lookPreset: pick a VISUAL LOOK that best matches the music mood + user's phrase (arousal/valence, words like "dreamy", "aggressive", "cold"). Return the key only — no prefix. Emit null if nothing clearly fits. Valid look keys: ${lookList}.
- atmosphere: ALWAYS emit 1–3 short comma-joined sumi-e clauses (ink, paper, drift, fog, shadow, light, silence, stillness, wet, fibre). Even if the phrase was a pure command, emit atmosphere informed by the scene + mood.

GOOD:
User: "a heron over grey water" (arousal 0.3, valence 0.4)
→ {"patch":{"subject":"a heron","environment":"grey still water"},"commit":false,"reset":false,"preset":null,"lookPreset":"frost","atmosphere":"slow water, feathered silence, cold light"}

User: "pull it back" (current intensity 0.7, arousal 0.2)
→ {"patch":{"intensity":0.4},"commit":false,"reset":false,"preset":null,"lookPreset":"dust","atmosphere":"breath, quieting"}

User: "commit this"
→ {"patch":{},"commit":true,"reset":false,"preset":null,"lookPreset":null,"atmosphere":"held, still"}

User: "try the cathedral one"
→ {"patch":{},"commit":false,"reset":false,"preset":"cathedral","lookPreset":null,"atmosphere":"sacred dust, cold stone"}

User: "make it louder" (arousal 0.85)
→ {"patch":{},"commit":false,"reset":false,"preset":null,"lookPreset":"storm","atmosphere":"rushing wind, torn paper"}

User: "hmm"
→ {"patch":{},"commit":false,"reset":false,"preset":null,"lookPreset":null,"atmosphere":"quiet, held"}

Output ONLY the JSON object.`;
}

export interface VoiceIntentInput {
  phrase: string; // newest utterance
  scene: {
    subject: string;
    environment: string;
    mood: string;
    palette: string;
    intensity: number;
  };
  voiceHistory: string[]; // newest-first, past 30s, excluding `phrase`
  valence: number; // 0..1, bright↔dark
  arousal: number; // 0..1, calm↔energetic
  previousAtmosphere: string | null;
}

export interface VoiceIntentOpts {
  signal: AbortSignal;
  logger: Logger;
}

export interface VoiceIntent {
  patch: {
    subject?: string;
    environment?: string;
    mood?: string;
    palette?: string;
    intensity?: number;
  };
  commit: boolean;
  reset: boolean;
  preset: string | null;
  lookPreset: VisualPresetName | null;
  atmosphere: string | null;
}

function buildUserPrompt(input: VoiceIntentInput): string {
  const historyBlock =
    input.voiceHistory.length > 0
      ? input.voiceHistory.map((p) => `  - "${p}"`).join("\n")
      : "  (none)";
  return `Current scene:
  subject: ${input.scene.subject || "(blank)"}
  environment: ${input.scene.environment || "(blank)"}
  mood: ${input.scene.mood || "(blank)"}
  palette: ${input.scene.palette || "(blank)"}
  intensity: ${input.scene.intensity.toFixed(2)}

Recent voice history (newest first, past 30s, older than the current phrase):
${historyBlock}

Music mood:
  valence (bright↔dark): ${input.valence.toFixed(2)}
  arousal (calm↔energetic): ${input.arousal.toFixed(2)}

Previous atmosphere (vary from this): "${input.previousAtmosphere ?? "(none)"}"

User just said:
"${input.phrase}"

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
  // Remove ```json ... ``` or ``` ... ``` if the LLM wrapped it anyway.
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
  const m = out.match(fence);
  if (m?.[1]) out = m[1].trim();
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function coerceIntent(raw: unknown): VoiceIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;

  // patch
  const patch: VoiceIntent["patch"] = {};
  if (o.patch && typeof o.patch === "object") {
    const p = o.patch as Record<string, unknown>;
    if (typeof p.subject === "string" && p.subject.trim())
      patch.subject = p.subject.trim();
    if (typeof p.environment === "string" && p.environment.trim())
      patch.environment = p.environment.trim();
    if (typeof p.mood === "string" && p.mood.trim()) patch.mood = p.mood.trim();
    if (typeof p.palette === "string" && p.palette.trim())
      patch.palette = p.palette.trim();
    if (typeof p.intensity === "number")
      patch.intensity = clamp01(p.intensity);
  }

  const commit = typeof o.commit === "boolean" ? o.commit : false;
  const reset = typeof o.reset === "boolean" ? o.reset : false;

  let preset: string | null = null;
  if (typeof o.preset === "string") {
    const k = o.preset.trim().toLowerCase();
    if (k.length > 0 && k !== "null") preset = k;
  }

  let lookPreset: VisualPresetName | null = null;
  if (typeof o.lookPreset === "string") {
    const k = o.lookPreset.trim().toLowerCase();
    if ((VISUAL_PRESET_NAMES as readonly string[]).includes(k)) {
      lookPreset = k as VisualPresetName;
    }
  }

  let atmosphere: string | null = null;
  if (typeof o.atmosphere === "string") {
    const a = o.atmosphere.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "").trim();
    if (a.length > 0) atmosphere = a;
  }

  return { patch, commit, reset, preset, lookPreset, atmosphere };
}

let _warnedNoKey = false;

// Fallback intent used when the LLM is unavailable. Atmosphere still flows
// (via the curated static pool) so the image keeps breathing; structural
// intent stays empty.
function fallbackIntent(): VoiceIntent {
  return {
    patch: {},
    commit: false,
    reset: false,
    preset: null,
    lookPreset: null,
    atmosphere: sampleDrift(),
  };
}

export async function parseVoiceIntent(
  input: VoiceIntentInput,
  opts: VoiceIntentOpts,
): Promise<VoiceIntent> {
  if (!process.env.FAL_KEY) {
    if (!_warnedNoKey) {
      _warnedNoKey = true;
      opts.logger.warn(
        "FAL_KEY not set — voice-intent LLM disabled, falling back to atmospheric pool",
      );
    }
    return fallbackIntent();
  }

  const model = process.env.FAL_LLM_MODEL ?? DEFAULT_MODEL;

  try {
    const result = await fal.subscribe("fal-ai/any-llm", {
      input: {
        model,
        system_prompt: buildSystemPrompt(),
        prompt: buildUserPrompt(input),
        max_tokens: MAX_OUTPUT_TOKENS,
        priority: "latency",
      },
      logs: false,
      abortSignal: opts.signal,
    });
    if (opts.signal.aborted) return fallbackIntent();

    const output = extractOutput(result?.data);
    if (!output) {
      opts.logger.debug({ result }, "voice-intent: empty output");
      return fallbackIntent();
    }

    const stripped = stripFences(output);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      opts.logger.warn({ err, output: stripped }, "voice-intent: JSON parse failed");
      return fallbackIntent();
    }
    const intent = coerceIntent(parsed);
    if (!intent) {
      opts.logger.warn({ parsed }, "voice-intent: coercion failed");
      return fallbackIntent();
    }
    return intent;
  } catch (err) {
    if (opts.signal.aborted) return fallbackIntent();
    opts.logger.warn({ err }, "voice-intent: fal any-llm error");
    return fallbackIntent();
  }
}
