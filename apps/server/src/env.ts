import { z } from "zod";

// Startup-time env validation. Required keys fail the parse immediately so
// the server refuses to boot into a half-configured state. Optional model
// overrides stay optional because they have sane defaults.
const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  // Required — without any of these the server cannot do its job.
  BETTER_AUTH_SECRET: z.string().min(1), // HMAC key for WS ticket verification
  DATABASE_URL: z.string().url(), // credits ledger + SIWE nonces
  FAL_KEY: z.string().min(1), // image generation (BYOK is an override, not a mode)
  AUDD_API_KEY: z.string().min(1), // song recognition

  // Optional — FAL model overrides ship with defaults.
  FAL_LLM_MODEL: z.string().optional(),
  FAL_TEXT_MODEL: z.string().default("fal-ai/flux-2/klein/9b"),
  FAL_EDIT_MODEL: z.string().default("fal-ai/flux-2/klein/9b/edit"),
  FAL_COMMIT_TEXT_MODEL: z.string().default("fal-ai/flux-2-pro"),
  FAL_COMMIT_EDIT_MODEL: z.string().default("fal-ai/flux-2-pro/edit"),
});

export const env = envSchema.parse(Bun.env);
export type Env = typeof env;
