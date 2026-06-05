import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import { Pool } from "pg";

import * as SCHEMA from "./schema";

export { SCHEMA };
export type Database =
  | NodePgDatabase<typeof SCHEMA>
  | PgliteDatabase<typeof SCHEMA>;

// Cached pool per connection string — keeps warm pg.Pools across Next.js
// route handlers within the same lambda instance.
const POOLS = new Map<string, Pool>();

const getPool = (databaseUrl: string): Pool => {
  let pool = POOLS.get(databaseUrl);
  if (!pool) {
    pool = new Pool({ connectionString: databaseUrl });
    POOLS.set(databaseUrl, pool);
  }
  return pool;
};

export const createDb = (databaseUrl: string): Database =>
  drizzle(getPool(databaseUrl), { schema: SCHEMA });
