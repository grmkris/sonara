import { defineNodeInstrumentation } from "@sonara/logger/next/instrumentation";

// Root instrumentation entry. `defineNodeInstrumentation` gates the real config
// (lib/evlog.ts) behind a `NEXT_RUNTIME === 'nodejs'` dynamic import so Edge
// bundles stay free of Node-only code.
export const { register, onRequestError } = defineNodeInstrumentation(
  () => import("./lib/evlog")
);
