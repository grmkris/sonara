import { fal } from "@fal-ai/client";
import type { NowPlaying } from "@sonara/shared";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Song muse — LLM translation from track metadata into a single evocative
// sumi-e prompt sentence. Output is fed into scene.prompt when the user
// hasn't authored their own prompt. We ask the same `any-llm` model we use
// for the scene expander to ABSTRACT the song (never quote title / artist)
// into one sentence the FLUX pipeline can render.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 180;
const MAX_PROMPT_CHARS = 140;

export interface SongMuseInput {
  track: NowPlaying;
  valence: number;
  arousal: number;
  bpm: number;
}

export interface SongMusePatch {
  prompt: string;
}

export interface SongMuseOpts {
  signal: AbortSignal;
  logger: Logger;
}

function buildSystemPrompt(): string {
  return `You translate a recognized song into a single evocative sumi-e-style scene description. Given track metadata and the live audio mood, emit a SINGLE JSON object — no prose, no markdown fences, no commentary:

{ "prompt": string }   // ONE sentence describing a concrete visual scene; ≤ ${MAX_PROMPT_CHARS} characters

RULES:
- Translate, don't quote. NEVER use the artist's name or the track's title literally. Abstract the song's IMAGE, MOOD, and ARCHETYPE into a scene.
- The sentence must name a CONCRETE VISUAL SUBJECT (a figure, a creature, an object, a landscape element) and ideally hint at setting, mood, and palette.
- Stay sumi-e / ethereal / dreamlike — single-figure, minimal, evocative; no photoreal specifics, no proper names.
- One sentence. No leading "a scene of" or "an image showing" — just describe the scene directly.

GOOD:
Track: Rihanna — Umbrella (valence 0.45, arousal 0.55)
→ {"prompt":"a figure sheltering beneath a dark umbrella on a rain-slicked neon street, warmth in storm, indigo and wet gold"}

Track: Sigur Rós — Svefn-g-englar (valence 0.60, arousal 0.20, 60 bpm)
→ {"prompt":"a drifting angel above a cold northern sea at dawn, hushed and weightless, pearl and slate"}

Track: Miles Davis — So What (valence 0.35, arousal 0.40)
→ {"prompt":"smoke curling above an empty jazz stage in a late-night lounge, cool and contemplative, smoke and brass and cognac"}

Track: Daft Punk — Around the World (valence 0.75, arousal 0.85, 122 bpm)
→ {"prompt":"a neon orbit spinning through a mirrored club interior in synthetic light, euphoric and relentless, magenta and chrome"}

Output ONLY the JSON object.`;
}

function buildUserPrompt(input: SongMuseInput): string {
  const t = input.track;
  return `Track:
  title: ${t.title}
  artist: ${t.artist}
  album: ${t.album ?? "(unknown)"}
  genre: ${t.genre ?? "(unknown)"}
  releaseYear: ${t.releaseYear ?? "(unknown)"}

Live audio mood:
  valence (bright↔dark): ${input.valence.toFixed(2)}
  arousal (calm↔energetic): ${input.arousal.toFixed(2)}
  bpm: ${input.bpm > 0 ? Math.round(input.bpm) : "(unknown)"}

Emit the JSON object.`;
}

interface AnyLlmResult {
  output?: string;
}

function extractOutput(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const r = data as AnyLlmResult;
  return typeof r.output === "string" ? r.output : null;
}

function stripFences(text: string): string {
  let out = text.trim();
  const m = out.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (m?.[1]) out = m[1].trim();
  return out;
}

function coerce(raw: unknown): SongMusePatch | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.prompt !== "string") return null;
  const cleaned = o.prompt
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\.+$/, "")
    .trim();
  if (cleaned.length === 0) return null;
  // Hard cap so a runaway LLM can't dump a paragraph into the prompt slot.
  const capped =
    cleaned.length > MAX_PROMPT_CHARS
      ? cleaned.slice(0, MAX_PROMPT_CHARS).trimEnd()
      : cleaned;
  return { prompt: capped };
}

export async function synthesizeFromTrack(
  input: SongMuseInput,
  opts: SongMuseOpts,
): Promise<SongMusePatch | null> {
  if (!env.FAL_KEY) {
    opts.logger.debug("song-muse: FAL_KEY not set, skipping");
    return null;
  }
  const model = env.FAL_LLM_MODEL ?? DEFAULT_MODEL;

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
    if (opts.signal.aborted) return null;

    const output = extractOutput(result?.data);
    if (!output) {
      opts.logger.debug({ result }, "song-muse: empty output");
      return null;
    }
    const stripped = stripFences(output);
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripped);
    } catch (err) {
      opts.logger.warn({ err, output: stripped }, "song-muse: JSON parse failed");
      return null;
    }
    const patch = coerce(parsed);
    if (!patch) {
      opts.logger.debug({ parsed }, "song-muse: coercion returned empty");
      return null;
    }
    return patch;
  } catch (err) {
    if (opts.signal.aborted) return null;
    opts.logger.warn({ err }, "song-muse: fal any-llm error");
    return null;
  }
}
