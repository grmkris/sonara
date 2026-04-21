import { z } from "zod";

// Server-only vars. Read at request/runtime on the server. Never bundle into
// client code (Next.js will strip anything not prefixed with `NEXT_PUBLIC_`).
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  AUTH_DOMAIN: z.string().default("localhost:3000"),
  APP_URL: z.string().url().default("http://localhost:3000"),
});

// Client-readable vars. Next.js inlines `NEXT_PUBLIC_*` references at build
// time, so we parse a literal object (not `process.env`) to get both
// server-render and client-hydrate access via the same module.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_WS_URL: z.string().default("ws://localhost:3001/ws"),
  NEXT_PUBLIC_REOWN_PROJECT_ID: z.string().default(""),
  NEXT_PUBLIC_PAY_RECIPIENT_BASE: z.string().optional(),
});

// Server-side parsing. Safe to call from any server-only module.
export const env =
  typeof window === "undefined"
    ? serverEnvSchema.parse(process.env)
    : // On the client, serverEnvSchema fields are undefined — accessing them
      // would throw. Callers of `env.*` must be in server-only code.
      (undefined as unknown as z.infer<typeof serverEnvSchema>);

// Client/server-readable. Uses literal references so Next.js can inline.
export const publicEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  NEXT_PUBLIC_REOWN_PROJECT_ID: process.env.NEXT_PUBLIC_REOWN_PROJECT_ID,
  NEXT_PUBLIC_PAY_RECIPIENT_BASE: process.env.NEXT_PUBLIC_PAY_RECIPIENT_BASE,
});

export type Env = typeof env;
export type PublicEnv = typeof publicEnv;
