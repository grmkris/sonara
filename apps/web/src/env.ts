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
  // "true" on the public dev build (dev.sonara.fm) to load the react-grab
  // overlay; unset in prod. Read directly in layout.tsx — documented here so
  // the full set of public vars lives in one place.
  NEXT_PUBLIC_ENABLE_DEVTOOLS: z.string().optional(),
});

export const publicEnv = clientEnvSchema.parse({
  NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
  NEXT_PUBLIC_ENABLE_DEVTOOLS: process.env.NEXT_PUBLIC_ENABLE_DEVTOOLS,
});

export type PublicEnv = typeof publicEnv;
