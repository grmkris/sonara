import { createSonaraWebEvlog } from "@sonara/logger/next";

// Real (Node-only) logger config. Loaded by `instrumentation.ts` exclusively in
// the Node.js runtime via `defineNodeInstrumentation`, so the Edge bundle never
// pulls this in. `register`/`onRequestError` wire evlog into Next's
// instrumentation hooks; `withEvlog`/`useLogger`/`log` are for server-side
// request logging (server components, route handlers) as the app grows.
export const { register, onRequestError, withEvlog, useLogger, log } =
  createSonaraWebEvlog(process.env.NEXT_PUBLIC_APP_ENV ?? "local");
