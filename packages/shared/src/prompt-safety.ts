// Prompt input length cap. Bounds LLM cost + abuse; enforced on the client
// (input maxLength) and again server-side (defense in depth). Content
// moderation itself is done by the LLM expander in one pass (it emits a `safe`
// verdict and authors a funny SFW denial when a prompt is inappropriate for a
// public screen) — no hardcoded word/scene lists.
export const MAX_PROMPT_CHARS = 240;

export const clampPrompt = (s: string): string =>
  s.length > MAX_PROMPT_CHARS ? s.slice(0, MAX_PROMPT_CHARS) : s;
