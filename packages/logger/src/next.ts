import type { EnvironmentContext } from "evlog";
import { createEvlog } from "evlog/next";
import { createInstrumentation } from "evlog/next/instrumentation";

// Node-runtime web helpers. Only import this module from server-side code that
// runs in Node (e.g. `lib/evlog.ts`, loaded via `defineNodeInstrumentation`) —
// it pulls evlog/next which depends on `node:async_hooks`. Edge code should use
// `@sonara/logger/next/instrumentation` instead.
// `withEvlog` is not a top-level export — it's returned from `createEvlog()`
// (and surfaced via `createSonaraWebEvlog` below).
export { createEvlog, evlogMiddleware, log, useLogger } from "evlog/next";

/**
 * Build sonara-web's evlog runtime + instrumentation handlers in one call.
 * `pretty` follows the environment (human output everywhere except prod).
 *
 * Returns `{ register, onRequestError, withEvlog, useLogger, log, createError }`.
 */
export const createSonaraWebEvlog = (appEnv: string) => {
  const env: Partial<EnvironmentContext> = {
    environment: appEnv,
    service: "sonara-web",
  };
  const common = { env, pretty: appEnv !== "prod", service: "sonara-web" };
  return {
    ...createInstrumentation(common),
    ...createEvlog(common),
  };
};
