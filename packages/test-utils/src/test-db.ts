import type { PGlite } from "@electric-sql/pglite";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { migrationsFolder } from "@sonara/db/migrations-path";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { createPgLite } from "./pg-lite";
import { pgliteAsPool } from "./pg-pool-shim";
import type { PoolShim } from "./pg-pool-shim";

// In-memory Postgres carrying the REAL schema: every migration in
// packages/db/drizzle is applied, so partial unique indexes, FKs and defaults
// match production exactly — no hand-written DDL drift.
export interface TestDb {
  db: Database;
  pg: PGlite;
  pool: PoolShim;
  close: () => Promise<void>;
  reset: () => Promise<void>;
}

export const createTestDb = async (): Promise<TestDb> => {
  const pg = createPgLite();
  const db: Database = drizzle(pg, { schema: SCHEMA });
  await migrate(db, { migrationsFolder });

  // The table set is fixed after migrate(), so introspect once and cache the
  // TRUNCATE statement. Drizzle's migration bookkeeping lives in the
  // `drizzle` schema — outside `public`, untouched by reset().
  const tables = await pg.query<{ tablename: string }>(
    `SELECT tablename FROM pg_catalog.pg_tables
     WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`
  );
  const truncateSql = `TRUNCATE ${tables.rows
    .map((t) => `"${t.tablename}"`)
    .join(", ")} RESTART IDENTITY CASCADE`;

  return {
    close: () => pg.close(),
    db,
    pg,
    pool: pgliteAsPool(pg),
    reset: async () => {
      await pg.exec(truncateSql);
    },
  };
};

let shared: TestDb | null = null;
let sharedPromise: Promise<TestDb> | null = null;

// Process-wide singleton: bun runs test files sequentially in one process, so
// sharing a single migrated PGlite avoids the WASM cold-start per file. Files
// isolate themselves via reset() (beforeEach, or beforeAll for cumulative
// suites). close() on the shared handle is a no-op — individual files must
// never close it (they'd kill it for the files after them); the real
// teardown happens once at process drain.
export const getTestDb = (): Promise<TestDb> => {
  if (shared) {
    return Promise.resolve(shared);
  }
  if (sharedPromise) {
    return sharedPromise;
  }
  sharedPromise = (async () => {
    const t = await createTestDb();
    shared = { ...t, close: () => Promise.resolve() };
    return shared;
  })();
  return sharedPromise;
};

// Real teardown for the shared instance. bun exits 99 when a PGlite WASM
// handle is still open at the end of `bun test` (even with every test
// green), and per-file afterAll can't own this (it would kill the singleton
// for the files after it) — call this from a global preload's afterAll
// (bunfig.toml [test] preload), which runs once after ALL files.
export const closeSharedTestDb = async (): Promise<void> => {
  const t = shared ?? (sharedPromise ? await sharedPromise : null);
  shared = null;
  sharedPromise = null;
  if (t) {
    await t.pg.close();
  }
};
