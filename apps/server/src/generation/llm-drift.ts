import Anthropic from "@anthropic-ai/sdk";
import type { Logger } from "../lib/logger";

// Haiku is the right tier for this: small, cheap, fast. A call is ~260 tokens
// in / ~30 out, ~$0.0002/call. At the session's 10s min interval this is
// ~$0.07/hour of use — fal dwarfs it.
//
// Note: Haiku 4.5 has a 4096-token minimum for prompt caching. Our system
// prompt is ~180 tokens, so caching would silently not kick in — we don't
// bother with cache_control here. If we ever expand the prompt above 4k
// (e.g. many few-shot examples), add `cache_control: {type: "ephemeral"}`
// to the system block.
const MODEL = "claude-haiku-4-5";
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

// Lazy singleton — avoids constructing the client (and the auth warning)
// unless a key is present. Returns null when unavailable so callers can
// fall back to the static drift pool.
let _client: Anthropic | null | undefined = undefined;
let _warned = false;

function getClient(logger: Logger): Anthropic | null {
  if (_client !== undefined) return _client;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    _client = null;
    if (!_warned) {
      _warned = true;
      logger.warn(
        "ANTHROPIC_API_KEY not set — LLM drift synthesis disabled, falling back to voice phrases and static pool",
      );
    }
    return null;
  }
  _client = new Anthropic({ apiKey: key });
  return _client;
}

function buildUserMessage(input: SynthesizeInput): string {
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
  // Strip outer quotes if present.
  if (
    (out.startsWith('"') && out.endsWith('"')) ||
    (out.startsWith("'") && out.endsWith("'"))
  ) {
    out = out.slice(1, -1).trim();
  }
  // Kill any trailing period — the clauses are phrases, not sentences.
  out = out.replace(/\.+$/, "").trim();
  return out.length > 0 ? out : null;
}

export async function synthesizeDrift(
  input: SynthesizeInput,
  opts: SynthesizeOpts,
): Promise<string | null> {
  const client = getClient(opts.logger);
  if (!client) return null;

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      },
      { signal: opts.signal },
    );

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text",
    );
    if (!textBlock) return null;
    return sanitize(textBlock.text);
  } catch (err) {
    if (opts.signal.aborted) return null;
    if (err instanceof Anthropic.RateLimitError) {
      opts.logger.warn({ status: err.status }, "llm drift: rate limited");
    } else if (err instanceof Anthropic.AuthenticationError) {
      opts.logger.warn("llm drift: authentication failed — check ANTHROPIC_API_KEY");
    } else if (err instanceof Anthropic.APIError) {
      opts.logger.warn(
        { status: err.status, message: err.message },
        "llm drift: API error",
      );
    } else {
      opts.logger.warn({ err }, "llm drift: unexpected error");
    }
    return null;
  }
}
