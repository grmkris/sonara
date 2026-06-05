import pg from "pg";

import { env } from "../env";

// Shared singleton pg.Pool used by credits.service and library-provider.
// Direct pg (no drizzle) keeps apps/server free of schema-package imports —
// each consumer writes plain SQL against the tables it owns.

export interface PoolLike {
  connect(): Promise<{
    query<T = unknown>(
      sql: string,
      params?: readonly unknown[]
    ): Promise<{ rows: T[]; rowCount: number | null }>;
    release(): void;
  }>;
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

let pool: PoolLike | null = null;

export function getPool(): PoolLike {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

// Test-only override. Pass `null` to clear and force getPool() to rebuild
// from env on the next call.
export function __setPoolForTests(p: PoolLike | null): void {
  pool = p;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end?.();
    pool = null;
  }
}
