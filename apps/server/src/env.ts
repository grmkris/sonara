import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),

  BETTER_AUTH_SECRET: z.string().min(1).optional(),

  DATABASE_URL: z.string().url().optional(),

  FAL_KEY: z.string().optional(),
  FAL_LLM_MODEL: z.string().optional(),
  FAL_TEXT_MODEL: z.string().default("fal-ai/flux-2/klein/9b"),
  FAL_EDIT_MODEL: z.string().default("fal-ai/flux-2/klein/9b/edit"),
  FAL_COMMIT_TEXT_MODEL: z.string().default("fal-ai/flux-2-pro"),
  FAL_COMMIT_EDIT_MODEL: z.string().default("fal-ai/flux-2-pro/edit"),

  AUDD_API_KEY: z.string().optional(),
  SPOTIFY_CLIENT_ID: z.string().optional(),
  SPOTIFY_CLIENT_SECRET: z.string().optional(),
});

export const env = envSchema.parse(Bun.env);
export type Env = typeof env;
