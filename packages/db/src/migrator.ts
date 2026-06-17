import path from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

// Apply pending migrations from the bundled `drizzle/` folder. Called on
// server boot before Bun.serve binds, mirroring the pattern in
// ai-stilist/zednabi-v2/invok admin-api.
export const runMigrations = async (databaseUrl: string): Promise<void> => {
  const client = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(client);
    const migrationsFolder = path.join(import.meta.dirname, "../drizzle");
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
};
