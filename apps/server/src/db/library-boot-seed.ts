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
// Fast path: when row count already meets the seed length we skip without
// touching disk. Otherwise we INSERT ... ON CONFLICT (prompt_hash) DO NOTHING
// per row, so partial states (someone curated half the deck by hand) heal
// instead of erroring.
export async function seedLibraryOnBoot(logger: Logger): Promise<void> {
  const seed = seedRows as ExportRow[];
  if (seed.length === 0) {
    logger.info("library seed file is empty — skipping");
    return;
  }

  const pool = getPool();
  const existing = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM image_library",
  );
  const current = Number(existing.rows[0]?.count ?? "0");
  if (current >= seed.length) {
    logger.info(
      { rows: current, seedSize: seed.length },
      "library already seeded — skipping import",
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
         ON CONFLICT (prompt_hash) DO NOTHING`,
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
        ],
      );
      if (res.rowCount && res.rowCount > 0) imported++;
      else skipped++;
    }
  } finally {
    client.release();
  }
  logger.info(
    { imported, skipped, total: seed.length },
    "library boot-seed complete",
  );
}
