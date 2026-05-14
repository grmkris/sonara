import { fal } from "@fal-ai/client";
import type { NowPlaying } from "@sonara/shared";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Song muse — LLM translation from track metadata into an evocative sumi-e
// scene. The deterministic `mergeNowPlayingIntoScene` path handles mood /
// palette / camera / intensity (cheap, sync). Subject needs more taste, so we
// ask the same LLM we use for voice intent to ABSTRACT the song (never quote
// title / artist) into a visual.

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";
const MAX_OUTPUT_TOKENS = 220;

export interface SongMuseInput {
  track: NowPlaying;
  valence: number;
  arousal: number;
  bpm: number;
}

export interface SongMusePatch {
  subject?: string;
  environment?: string;
  action?: string;
  mood?: string;
}

export interface SongMuseOpts {
  signal: AbortSignal;
  logger: Logger;
}

function buildSystemPrompt(): string {
  return `You translate a recognized song into an evocative sumi-e-style visual scene. Given the track metadata and the live audio mood, emit a SINGLE JSON object — no prose, no markdown fences, no commentary:

{
  "subject": string | null,       // concrete visual subject, 2–6 words — NEVER the track title or artist name
  "environment": string | null,   // setting/place, 2–8 words
  "action": string | null,        // present-participle phrase, 2–6 words
  "mood": string | null           // emotional register, 1–4 words
}

RULES:
- Translate, don't quote. Do NOT use the artist's name or the track's title literally. Abstract the song's IMAGE, MOOD, and ARCHETYPE into a scene.
- Subject must be CONCRETE and VISUAL (a figure, a creature, an object, a landscape element). No proper names. No abstractions like "melody" or "rhythm".
- Stay sumi-e / ethereal / dreamlike — single-figure, minimal, evocative; no photoreal specifics.
- Fields are optional. Return null for any field you can't synthesize meaningfully.

GOOD:
Track: Rihanna — Umbrella (valence 0.45, arousal 0.55)
→ {"subject":"figure beneath a dark umbrella","environment":"rain-slicked neon street","action":"sheltering from the downpour","mood":"warmth in storm"}

Track: Sigur Rós — Svefn-g-englar (valence 0.60, arousal 0.20, 60 bpm)
→ {"subject":"a drifting angel","environment":"cold northern sea at dawn","action":"floating above still water","mood":"hushed, weightless"}

Track: Miles Davis — So What (valence 0.35, arousal 0.40)
→ {"subject":"an empty jazz stage","environment":"late-night lounge","action":"smoke curling upward","mood":"cool, contemplative"}

Track: Daft Punk — Around the World (valence 0.75, arousal 0.85, 122 bpm)
→ {"subject":"a neon orbit","environment":"mirrored club interior","action":"spinning in synthetic light","mood":"euphoric, relentless"}

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

function trimField(raw: unknown, maxWords: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw.trim().replace(/^["']|["']$/g, "").replace(/\.+$/, "").trim();
  if (cleaned.length === 0) return undefined;
  const words = cleaned.split(/\s+/);
  if (words.length > maxWords) return words.slice(0, maxWords).join(" ");
  return cleaned;
}

function coerce(raw: unknown): SongMusePatch | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const patch: SongMusePatch = {};
  const subject = trimField(o.subject, 8);
  const environment = trimField(o.environment, 10);
  const action = trimField(o.action, 8);
  const mood = trimField(o.mood, 6);
  if (subject) patch.subject = subject;
  if (environment) patch.environment = environment;
  if (action) patch.action = action;
  if (mood) patch.mood = mood;
  return Object.keys(patch).length > 0 ? patch : null;
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
