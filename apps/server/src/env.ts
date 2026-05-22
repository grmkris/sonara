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
  DATABASE_URL: z.string().url(), // credits ledger + auth tables
  FAL_KEY: z.string().min(1), // image generation
  AUDD_API_KEY: z.string().min(1), // song recognition

  // Optional — text-mode fal model. Every text-mode keyframe goes through
  // this one text-to-image endpoint. No /edit pipeline.
  FAL_TEXT_MODEL: z.string().default("fal-ai/flux-2/klein/9b"),
  // Image-anchor fal model — accepts image_url + image_prompt_strength.
  // Separate code path from FAL_TEXT_MODEL (see anchor-provider.ts).
  // Heavier model, billed at ANCHOR_FRAME_COST_CREDITS per frame.
  FAL_ANCHOR_MODEL: z.string().default("fal-ai/flux-pro/v1.1-ultra"),
  // LLM endpoint used by scene-llm-expander (drift candidate generation) and
  // song-muse (track → prompt synthesis). Not used by voice — voice is
  // direct dictation with no LLM round-trip.
  FAL_LLM_MODEL: z.string().optional(),
});

export const env = envSchema.parse(Bun.env);
export type Env = typeof env;
