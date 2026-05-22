import { z } from "zod";

// The web app is a thin frontend now: auth, DB, payments and uploads all live
// on the server (reached same-origin via the Caddy gateway). So the only env
// it needs is the public WebSocket URL plus an optional server-internal RPC
// URL used during SSR (no window → can't use the gateway origin).

// Client-readable vars. Next.js inlines `NEXT_PUBLIC_*` references at build
// time, so we parse a literal object (not `process.env`) to get both
// server-render and client-hydrate access via the same module.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_WS_URL: z.string().default("ws://localhost:4470/ws"),
});

export const publicEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
});

export type PublicEnv = typeof publicEnv;
