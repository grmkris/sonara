import { PGlite } from "@electric-sql/pglite";

// Spin up an in-memory Postgres (WASM) for tests. Extensions needed by our
// schema must be loaded here — loading them later via `CREATE EXTENSION` on
// PGlite is a no-op on some builds.
export function createPgLite(): PGlite {
  return new PGlite({
    extensions: {},
  });
}

export type TestPg = PGlite;
