import { Environment } from "@sonara/shared";
import { z } from "zod";

// The web app is a thin frontend now: auth, DB, payments and uploads all live
// on the server (reached same-origin via the Caddy gateway). The only env it
// needs is the environment identity — every per-environment URL (the WS origin,
// the SSR-internal RPC base) is derived from SERVICE_URLS[NEXT_PUBLIC_APP_ENV],
// and devtools are gated on it too. One var instead of a scattered URL set.

// Client-readable vars. Next.js inlines `NEXT_PUBLIC_*` references at build
// time, so we parse a literal object (not `process.env`) to get both
// server-render and client-hydrate access via the same module.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_ENV: Environment,
});

export const publicEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
});

export type PublicEnv = typeof publicEnv;
