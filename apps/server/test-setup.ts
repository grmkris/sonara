import { afterAll } from "bun:test";

import { closeSharedTestDb } from "@sonara/test-utils/test-db";

// Global teardown (bunfig.toml [test] preload): hooks registered here wrap
// the WHOLE run, not one file. Closes the shared PGlite once after all test
// files — an open WASM handle makes `bun test` exit 99 despite a green suite.
afterAll(async () => {
  await closeSharedTestDb();
});
