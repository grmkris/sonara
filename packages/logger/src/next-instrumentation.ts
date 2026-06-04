// Edge-safe entry for the root `instrumentation.ts`. `defineNodeInstrumentation`
// gates the real (Node-only) logger config behind a `NEXT_RUNTIME === 'nodejs'`
// dynamic import, so the Edge bundle never pulls `node:async_hooks` or drains.
export { defineNodeInstrumentation } from "evlog/next/instrumentation";
