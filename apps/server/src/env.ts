import { z } from "zod";

// Startup-time env validation. Required keys fail the parse immediately so
// the server refuses to boot into a half-configured state. Optional model
// overrides stay optional because they have sane defaults.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4471),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Required — without any of these the server cannot do its job.
  BETTER_AUTH_SECRET: z.string().min(1), // HMAC key for WS ticket verification
  DATABASE_URL: z.string().url(), // credits ledger + SIWE nonces
  FAL_KEY: z.string().min(1), // image generation (BYOK is an override, not a mode)
  AUDD_API_KEY: z.string().min(1), // song recognition

  // Optional — FAL model overrides ship with defaults.
  // Anchor runs the session's first frame; every subsequent frame is a flow
  // edit on top of that anchor. No text-only fallback — flow always has the
  // hero to edit, and anchor failures retry on the next periodic tick.
  FAL_ANCHOR_TEXT_MODEL: z.string().default("fal-ai/flux-2-pro"),
  FAL_ANCHOR_EDIT_MODEL: z.string().default("fal-ai/flux-2-pro/edit"),
  FAL_FLOW_EDIT_MODEL: z.string().default("fal-ai/flux-2/klein/9b/edit"),
  // LLM endpoint used by scene-llm-expander (drift candidate generation) and
  // song-muse (track → subject synthesis). Not used by voice — voice is
  // direct field-keyed PTT with no LLM round-trip.
  FAL_LLM_MODEL: z.string().optional(),
});

export const env = envSchema.parse(Bun.env);
export type Env = typeof env;
