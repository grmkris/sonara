import { createDb } from "@sonara/db";
import type { Database } from "@sonara/db";

import { env } from "../env";

// Shared singleton drizzle handle for the non-router server modules (credits,
// persist-frame, recording-set, boot files) that aren't handed a `context.db`.
// createDb pools per connection string, so this is cheap and sits on the same
// warm pool as the request-scoped db. Using drizzle (not raw pg) keeps these
// modules in typeid space: the schema's typeId columns translate typeid↔uuid.
let db: Database | null = null;

export const getDb = (): Database => {
  if (!db) {
    db = createDb(env.DATABASE_URL);
  }
  return db;
};

// Test seam: inject the PGlite test db so the migrated modules query the test
// schema; pass null to reset (the next getDb rebuilds from env).
export const __setDbForTests = (d: Database | null): void => {
  db = d;
};
