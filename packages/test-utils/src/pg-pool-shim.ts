import type { PGlite } from "@electric-sql/pglite";

// Minimal `pg.Pool`-shaped shim around a PGlite instance, matching the subset
// used by `apps/server/src/credits/credits.service.ts`:
//
//   - `pool.connect()` returning a client with `query()` + `release()`
//   - `pool.query(sql, params)` for non-transactional queries
//
// PGlite is single-connection, so the "client" returned by connect() is the
// same instance every time. Two parallel callers share state — fine for the
// debit-race tests that explicitly want this. Production behavior is what the
// tests assert against.
export interface PoolShim {
  connect: () => Promise<{
    query: <T = unknown>(
      sql: string,
      params?: readonly unknown[]
    ) => Promise<{ rows: T[]; rowCount: number | null }>;
    release: () => void;
  }>;
  query: <T = unknown>(
    sql: string,
    params?: readonly unknown[]
  ) => Promise<{ rows: T[]; rowCount: number | null }>;
}

export const pgliteAsPool = (db: PGlite): PoolShim => {
  const run = async <T>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }> => {
    const res = await db.query(sql, params as unknown[] | undefined);
    // PGlite reports `affectedRows` only for INSERT/UPDATE/DELETE; SELECTs
    // come back with affectedRows=0 and the data in `rows`. node-postgres
    // semantics for `rowCount` cover both — so pick the larger of the two.
    const affected =
      typeof res.affectedRows === "number" ? res.affectedRows : 0;
    return {
      rowCount: Math.max(affected, res.rows.length),
      rows: res.rows as T[],
    };
  };
  return {
    connect: () =>
      Promise.resolve({
        query: run,
        release: () => {
          // no-op — PGlite is single-connection
        },
      }),
    query: run,
  };
};
