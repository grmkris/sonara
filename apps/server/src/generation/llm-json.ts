import { createFalClient } from "@fal-ai/client";

import { env } from "../env";

// Shared "ask an LLM for a JSON object" transport, used by every server-side
// expander (scene-llm-expander, expand-set, …). Picks Google Gemini directly
// when GEMINI_API_KEY is set (skips fal any-llm's ~1.5-2s queue overhead),
// else falls back to fal's any-llm endpoint over the shared FAL key (zero
// config). Callers own the JSON discipline (stripFences → JSON.parse →
// zod-validate → deterministic fallback); this module only returns the raw
// model text (possibly fenced) or null, and throws on a transport failure so
// the caller's try/catch routes to its fallback.

const DEFAULT_FAL_LLM_MODEL = "google/gemini-2.5-flash-lite";

// Strip a single ```json … ``` (or bare ```) fence the model may wrap the
// object in. Gemini's responseMimeType JSON avoids this; fal any-llm doesn't.
export const stripFences = (text: string): string => {
  let out = text.trim();
  const fence = /^```(?:json)?\s*\n?(?<body>[\s\S]*?)\n?```$/u;
  const m = out.match(fence);
  const body = m?.groups?.body;
  if (body !== undefined && body.length > 0) {
    out = body.trim();
  }
  return out;
};

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
  maxTokens: number,
  temperature: number,
  signal: AbortSignal | undefined
): Promise<string | null> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_MODEL}:generateContent`;
  const res = await fetch(url, {
    body: JSON.stringify({
      contents: [{ parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        responseMimeType: "application/json",
        temperature,
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

const callFalAnyLlm = async (
  system: string,
  user: string,
  maxTokens: number,
  signal: AbortSignal | undefined
): Promise<string | null> => {
  const model = env.FAL_LLM_MODEL ?? DEFAULT_FAL_LLM_MODEL;
  const scoped = createFalClient({ credentials: env.FAL_KEY });
  const result = await scoped.subscribe("fal-ai/any-llm", {
    abortSignal: signal,
    input: {
      max_tokens: maxTokens,
      model,
      priority: "latency",
      prompt: user,
      system_prompt: system,
    },
    logs: false,
  });
  return extractOutput(result?.data);
};

export interface CallLlmForJsonOpts {
  system: string;
  user: string;
  maxTokens: number;
  // Gemini sampling temperature (the fal any-llm path ignores it).
  temperature: number;
  signal?: AbortSignal;
}

// One LLM round-trip for a JSON object. Returns the raw text (caller strips
// fences + parses) or null when the model returned nothing. Throws on a
// transport error.
export const callLlmForJson = (
  opts: CallLlmForJsonOpts
): Promise<string | null> => {
  const apiKey = env.GEMINI_API_KEY;
  const useGemini = apiKey !== undefined && apiKey.length > 0;
  return useGemini
    ? callGemini(
        apiKey,
        opts.system,
        opts.user,
        opts.maxTokens,
        opts.temperature,
        opts.signal
      )
    : callFalAnyLlm(opts.system, opts.user, opts.maxTokens, opts.signal);
};
