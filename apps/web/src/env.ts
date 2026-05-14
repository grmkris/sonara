import { z } from "zod";

// Server-only vars. Read at request/runtime on the server. Never bundle into
// client code (Next.js will strip anything not prefixed with `NEXT_PUBLIC_`).
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.string().url(),
  BETTER_AUTH_SECRET: z.string().min(1),
  AUTH_DOMAIN: z.string().default("localhost:4470"),
  APP_URL: z.string().url().default("http://localhost:4470"),
  // Optional in dev — empty values disable the dodopayments plugin and the
  // checkout/webhook flow. Login works without Dodo configured. Required in
  // production deploys (set both via Railway env).
  DODO_PAYMENTS_API_KEY: z.string().default(""),
  DODO_PAYMENTS_WEBHOOK_SECRET: z.string().default(""),
  DODO_PAYMENTS_MODE: z.enum(["test_mode", "live_mode"]).default("test_mode"),
  // Optional in dev — same reasoning as the Dodo keys above. Required only
  // when the credits checkout flow is active.
  DODO_PRODUCT_STARTER: z.string().default(""),
  DODO_PRODUCT_PRO: z.string().default(""),
  DODO_PRODUCT_MAX: z.string().default(""),
});

// Client-readable vars. Next.js inlines `NEXT_PUBLIC_*` references at build
// time, so we parse a literal object (not `process.env`) to get both
// server-render and client-hydrate access via the same module.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_WS_URL: z.string().default("ws://localhost:4471/ws"),
});

// Lazy server-side parsing. Validation runs on first property access, not on
// module load — so `next build`'s "Collecting page data" pass (which loads
// route modules without Railway's runtime vars present) doesn't crash.
type ServerEnv = z.infer<typeof serverEnvSchema>;
let _serverEnv: ServerEnv | null = null;
function loadServerEnv(): ServerEnv {
  if (!_serverEnv) _serverEnv = serverEnvSchema.parse(process.env);
  return _serverEnv;
}
export const env = new Proxy({} as ServerEnv, {
  get(_target, prop) {
    if (typeof window !== "undefined") {
      // Callers of `env.*` must be in server-only code.
      return undefined;
    }
    return loadServerEnv()[prop as keyof ServerEnv];
  },
});

// Client/server-readable. Uses literal references so Next.js can inline.
export const publicEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
});

export type Env = typeof env;
export type PublicEnv = typeof publicEnv;
