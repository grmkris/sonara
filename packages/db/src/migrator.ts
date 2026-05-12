import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Apply pending migrations from the bundled `drizzle/` folder. Called on
// server boot before Bun.serve binds, mirroring the pattern in
// ai-stilist/zednabi-v2/invok admin-api.
export async function runMigrations(databaseUrl: string): Promise<void> {
  const client = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(client);
    const migrationsFolder = join(
      dirname(fileURLToPath(import.meta.url)),
      "../drizzle",
    );
    await migrate(db, { migrationsFolder });
  } finally {
    await client.end();
  }
}
