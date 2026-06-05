#!/usr/bin/env bun
/**
 * Dump every row in `image_library` to `library-seed.json`. The JSON file is
 * checked in and consumed by `seed-library.ts --from-export` so the same
 * rows (with the same ids and urls) can be replayed against a fresh DB
 * (production, a wiped local, a teammate's machine) without burning fal
 * credits or producing different filenames.
 *
 * Run from `apps/server/`:
 *   bun run export:library
 *
 * Reads DATABASE_URL from `apps/server/.env`.
 */

import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createDb, SCHEMA } from "@sonara/db";

import { env } from "../src/env";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function main() {
  if (!env.DATABASE_URL) {
    fail("DATABASE_URL not set");
  }

  const db = createDb(env.DATABASE_URL);
  const rows = await db
    .select({
      deck: SCHEMA.imageLibrary.deck,
      height: SCHEMA.imageLibrary.height,
      id: SCHEMA.imageLibrary.id,
      model: SCHEMA.imageLibrary.model,
      palette: SCHEMA.imageLibrary.palette,
      prompt: SCHEMA.imageLibrary.prompt,
      promptHash: SCHEMA.imageLibrary.promptHash,
      seed: SCHEMA.imageLibrary.seed,
      status: SCHEMA.imageLibrary.status,
      url: SCHEMA.imageLibrary.url,
      width: SCHEMA.imageLibrary.width,
    })
    .from(SCHEMA.imageLibrary)
    .orderBy(SCHEMA.imageLibrary.deck, SCHEMA.imageLibrary.promptHash);

  const out = resolve(import.meta.dirname, "library-seed.json");
  await writeFile(out, `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`exported ${rows.length} rows → ${out}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("export-library failed:", error);
  process.exit(1);
});
