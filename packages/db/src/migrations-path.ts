import path from "node:path";

// Absolute path to this package's bundled `drizzle/` migrations. Exported so
// the test harness can run the REAL migrations (PGlite) without guessing
// repo-relative paths — the path stays correct from src/ and dist/ alike.
export const migrationsFolder = path.join(import.meta.dirname, "../drizzle");
