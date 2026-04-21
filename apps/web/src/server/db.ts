import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import pg from "pg";
import * as SCHEMA from "./db/schema";

export { SCHEMA };
export type Database =
  | NodePgDatabase<typeof SCHEMA>
  | PgliteDatabase<typeof SCHEMA>;

// Cached pool per connection string — Next.js serverless invocations can reuse
// the pool across warm calls within the same lambda instance.
const POOLS = new Map<string, pg.Pool>();

function getPool(databaseUrl: string): pg.Pool {
  let pool = POOLS.get(databaseUrl);
  if (!pool) {
    pool = new pg.Pool({ connectionString: databaseUrl });
    POOLS.set(databaseUrl, pool);
  }
  return pool;
}

export function createDb(databaseUrl: string): Database {
  return drizzle(getPool(databaseUrl), { schema: SCHEMA });
}
