import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { eq, inArray } from "drizzle-orm";

import seedRows from "../../scripts/library-seed.json" with { type: "json" };
import type { Logger } from "../lib/logger";
import { getDb } from "./db";

interface ExportRow {
  id: string;
  deck: string;
  prompt: string;
  promptHash: string;
  model: string;
  seed: number | null;
  url: string;
  width: number;
  height: number;
  palette: string[] | null;
  status: "active" | "rejected";
}

// Idempotent import of apps/server/scripts/library-seed.json into the
// image_library table. Runs on every server boot after migrations — same
// rationale as the migration step: prod (and any fresh local DB) should
// converge to the committed seed without a manual railway-run.
//
// Fast path: skip only when every seed prompt_hash is already in the DB.
// A row-count check is unsafe — if the table was populated by an earlier
// seed shape the count may already exceed the new seed length while still
// missing rows we want present. Otherwise INSERT … ON CONFLICT (prompt_hash)
// DO NOTHING per row heals partial states. The conflict target carries the
// partial index predicate (WHERE source = 'seed') because 0002 narrowed
// image_library_prompt_hash_idx to seed rows — without it Postgres can't pick
// the arbiter index and a fresh-DB seed fails with 42P10.
export const seedLibraryOnBoot = async (
  logger: Logger,
  db: Database = getDb()
): Promise<void> => {
  const seed = seedRows as ExportRow[];
  if (seed.length === 0) {
    logger.info("library seed file is empty — skipping");
    return;
  }

  const hashes = seed.map((r) => r.promptHash);
  const present = await db
    .select({ promptHash: SCHEMA.imageLibrary.promptHash })
    .from(SCHEMA.imageLibrary)
    .where(inArray(SCHEMA.imageLibrary.promptHash, hashes));
  if (present.length === seed.length) {
    logger.info(
      { seedSize: seed.length },
      "library already seeded — skipping import"
    );
    return;
  }

  let imported = 0;
  let skipped = 0;
  // Serial on purpose: this runs once at boot on the shared pool; sequential
  // inserts bound startup DB load and keep the tally straightforward. Each row
  // is independent via ON CONFLICT.
  /* oxlint-disable no-await-in-loop -- sequential boot seed, see note above */
  for (const row of seed) {
    const inserted = await db
      .insert(SCHEMA.imageLibrary)
      .values({
        deck: row.deck,
        height: row.height,
        id: row.id as ImageLibraryId,
        model: row.model,
        palette: row.palette,
        prompt: row.prompt,
        promptHash: row.promptHash,
        seed: row.seed,
        status: row.status,
        url: row.url,
        width: row.width,
      })
      .onConflictDoNothing({
        target: SCHEMA.imageLibrary.promptHash,
        where: eq(SCHEMA.imageLibrary.source, "seed"),
      })
      .returning();
    if (inserted.length > 0) {
      imported += 1;
    } else {
      skipped += 1;
    }
  }
  /* oxlint-enable no-await-in-loop */
  logger.info(
    { imported, skipped, total: seed.length },
    "library boot-seed complete"
  );
};
