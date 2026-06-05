import { typeIdToUuid } from "@sonara/shared/typeid";

import seedRows from "../../scripts/library-seed.json" with { type: "json" };
import type { Logger } from "../lib/logger";
import { getPool } from "./pool";

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
// seed shape (different decks/prompts) the count may already exceed the
// new seed length while still missing rows we want present (e.g. a newly
// added deck). Otherwise INSERT ... ON CONFLICT (prompt_hash) DO NOTHING
// per row heals partial states. The conflict target carries the partial
// index predicate (WHERE source = 'seed') because 0002 narrowed
// image_library_prompt_hash_idx to seed rows — without it Postgres can't
// pick the arbiter index and a fresh-DB seed fails with 42P10.
export async function seedLibraryOnBoot(logger: Logger): Promise<void> {
  const seed = seedRows as ExportRow[];
  if (seed.length === 0) {
    logger.info("library seed file is empty — skipping");
    return;
  }

  const pool = getPool();
  const hashes = seed.map((r) => r.promptHash);
  const present = await pool.query<{ prompt_hash: string }>(
    "SELECT prompt_hash FROM image_library WHERE prompt_hash = ANY($1::text[])",
    [hashes]
  );
  if (present.rows.length === seed.length) {
    logger.info(
      { seedSize: seed.length },
      "library already seeded — skipping import"
    );
    return;
  }

  const client = await pool.connect();
  let imported = 0;
  let skipped = 0;
  try {
    for (const row of seed) {
      const idUuid = typeIdToUuid(row.id as `img_${string}`).uuid;
      const res = await client.query(
        `INSERT INTO image_library
           (id, deck, prompt, prompt_hash, model, seed, url, width, height, palette, status, created_at, updated_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now(), now())
         ON CONFLICT (prompt_hash) WHERE source = 'seed' DO NOTHING`,
        [
          idUuid,
          row.deck,
          row.prompt,
          row.promptHash,
          row.model,
          row.seed,
          row.url,
          row.width,
          row.height,
          row.palette,
          row.status,
        ]
      );
      if (res.rowCount && res.rowCount > 0) {
        imported++;
      } else {
        skipped++;
      }
    }
  } finally {
    client.release();
  }
  logger.info(
    { imported, skipped, total: seed.length },
    "library boot-seed complete"
  );
}
