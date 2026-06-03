#!/usr/bin/env bun
/**
 * Pre-generate the demo-mode image library. For each (deck, prompt) pair in
 * library-manifest.json, calls fal once, downloads the image, re-encodes to
 * WebP, writes it under apps/web/public/library/<deck>/, and inserts an
 * image_library row pointing at the relative URL.
 *
 * Idempotent: re-running skips rows whose (deck, prompt) hash is already
 * present in the DB.
 *
 * Usage:
 *   cd apps/server
 *   bun run seed:library                       # all decks, all prompts
 *   bun run seed:library -- --deck cute        # one deck
 *   bun run seed:library -- --deck cute --limit 3
 *   bun run seed:library -- --dry-run          # plan only, no fal calls
 *
 * Reads DATABASE_URL + FAL_KEY from apps/server/.env.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFalClient } from "@fal-ai/client";
import { createDb, SCHEMA } from "@sonara/db";
import {
  DECK_KEYS,
  type DeckKey,
} from "@sonara/shared";
import {
  type ImageLibraryId,
  typeIdGenerator,
} from "@sonara/shared/typeid";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { env } from "../src/env";
import { buildLibraryManifests } from "./build-library-manifests";

interface ManifestEntry {
  deck: DeckKey;
  prompts: string[];
}

interface Args {
  deck: DeckKey | null;
  limit: number | null;
  model: string;
  dryRun: boolean;
  fromExport: boolean;
}

interface ExportRow {
  id: ImageLibraryId;
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

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  let deck: DeckKey | null = null;
  let limit: number | null = null;
  let model = env.FAL_TEXT_MODEL;
  let dryRun = false;
  let fromExport = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--deck") {
      const v = argv[++i];
      if (!v || !(DECK_KEYS as readonly string[]).includes(v)) {
        fail(`--deck must be one of: ${DECK_KEYS.join(", ")}`);
      }
      deck = v as DeckKey;
    } else if (a === "--limit") {
      const v = Number(argv[++i]);
      if (!Number.isInteger(v) || v <= 0) fail("--limit must be a positive integer");
      limit = v;
    } else if (a === "--model") {
      const v = argv[++i];
      if (!v) fail("--model requires a value");
      model = v;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "--from-export") {
      fromExport = true;
    } else {
      fail(`unknown arg: ${a}`);
    }
  }
  return { deck, limit, model, dryRun, fromExport };
}

function promptHash(deck: string, prompt: string): string {
  return createHash("sha256").update(`${deck}::${prompt}`).digest("hex");
}

// Deterministic seed so re-generating a rejected prompt yields a similar
// image (modulo fal's nondeterminism on the same seed across model revs).
function promptSeed(prompt: string): number {
  const h = createHash("sha256").update(prompt).digest();
  return h.readUInt32BE(0) & 0x7fff_ffff;
}

interface FalImage {
  url: string;
  width?: number;
  height?: number;
}
interface FalData {
  images?: FalImage[];
  image?: FalImage;
}

function pickImage(result: unknown): FalImage | null {
  const data = (result as { data?: FalData } | undefined)?.data;
  if (!data) return null;
  if (data.image?.url) return data.image;
  if (data.images && data.images[0]?.url) return data.images[0];
  return null;
}

// apps/server/scripts/seed-library.ts -> repo root -> apps/web/public/library
function publicLibraryDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "../../web/public/library");
}

async function downloadAndEncode(url: string): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
}> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const transformed = await sharp(raw)
    .resize(1024, 1024, { fit: "cover" })
    .webp({ quality: 70 })
    .toBuffer({ resolveWithObject: true });
  return {
    buffer: transformed.data,
    width: transformed.info.width,
    height: transformed.info.height,
  };
}

async function importFromExport(args: Args): Promise<void> {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL not set");

  const exportPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "library-seed.json",
  );
  const raw = await Bun.file(exportPath).text();
  const rows = JSON.parse(raw) as ExportRow[];
  const filtered = args.deck ? rows.filter((r) => r.deck === args.deck) : rows;

  const db = createDb(databaseUrl);
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of filtered) {
    const existing = await db
      .select({ id: SCHEMA.imageLibrary.id })
      .from(SCHEMA.imageLibrary)
      .where(
        and(
          eq(SCHEMA.imageLibrary.promptHash, row.promptHash),
          eq(SCHEMA.imageLibrary.source, "seed"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      skipped++;
      continue;
    }
    try {
      await db.insert(SCHEMA.imageLibrary).values({
        id: row.id,
        deck: row.deck,
        prompt: row.prompt,
        promptHash: row.promptHash,
        model: row.model,
        seed: row.seed,
        url: row.url,
        width: row.width,
        height: row.height,
        palette: row.palette,
        status: row.status,
      });
      imported++;
      console.log(`  + ${row.deck}/${row.id}.webp  "${row.prompt.slice(0, 60)}"`);
    } catch (err) {
      console.error(`[fail] ${row.deck} "${row.prompt}":`, err);
      failed++;
    }
  }

  console.log(
    `\nfrom-export: ${imported} imported, ${skipped} skipped, ${failed} failed (out of ${filtered.length})`,
  );
  await buildLibraryManifests();
  process.exit(failed > 0 ? 1 : 0);
}

async function main() {
  const args = parseArgs();

  if (args.fromExport) {
    await importFromExport(args);
    return;
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL not set");
  if (!env.FAL_KEY && !args.dryRun) fail("FAL_KEY not set");
  if (process.env.APP_ENV === "prod" && process.env.ALLOW_PROD_SEED !== "1") {
    fail("refusing to seed in production — set ALLOW_PROD_SEED=1 to override");
  }

  const manifestPath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "library-manifest.json",
  );
  const manifestRaw = await Bun.file(manifestPath).text();
  const manifest = JSON.parse(manifestRaw) as ManifestEntry[];

  const decks = args.deck
    ? manifest.filter((m) => m.deck === args.deck)
    : manifest;
  if (decks.length === 0) fail(`no decks matched filter (--deck ${args.deck})`);

  const db = createDb(databaseUrl);
  const fal = createFalClient({ credentials: env.FAL_KEY });

  const baseDir = publicLibraryDir();

  let totalGen = 0;
  let totalSkip = 0;
  let totalFail = 0;

  for (const entry of decks) {
    const prompts = args.limit ? entry.prompts.slice(0, args.limit) : entry.prompts;
    let gen = 0;
    let skip = 0;
    let fail_ = 0;
    const deckDir = resolve(baseDir, entry.deck);
    await mkdir(deckDir, { recursive: true });

    for (const prompt of prompts) {
      const hash = promptHash(entry.deck, prompt);
      const existing = await db
        .select({ id: SCHEMA.imageLibrary.id })
        .from(SCHEMA.imageLibrary)
        .where(
          and(
            eq(SCHEMA.imageLibrary.promptHash, hash),
            eq(SCHEMA.imageLibrary.source, "seed"),
          ),
        )
        .limit(1);
      if (existing.length > 0) {
        skip++;
        continue;
      }

      if (args.dryRun) {
        console.log(`[dry-run] ${entry.deck}: ${prompt}`);
        gen++;
        continue;
      }

      const id = typeIdGenerator("imageLibrary") as ImageLibraryId;
      const seed = promptSeed(prompt);

      try {
        const result = await fal.subscribe(args.model, {
          input: {
            prompt,
            num_images: 1,
            num_inference_steps: 4,
            image_size: "square_hd",
            output_format: "jpeg",
            enable_safety_checker: false,
            seed,
          },
          logs: false,
        });
        const img = pickImage(result);
        if (!img) {
          console.warn(`[warn] ${entry.deck} "${prompt}": no image from fal`);
          fail_++;
          continue;
        }

        const { buffer, width, height } = await downloadAndEncode(img.url);
        const filename = `${id}.webp`;
        const filepath = resolve(deckDir, filename);
        await writeFile(filepath, buffer);

        const url = `/library/${entry.deck}/${filename}`;
        await db.insert(SCHEMA.imageLibrary).values({
          id,
          deck: entry.deck,
          prompt,
          promptHash: hash,
          model: args.model,
          seed,
          url,
          width,
          height,
          status: "active",
        });

        gen++;
        console.log(`  + ${entry.deck}/${filename}  "${prompt.slice(0, 60)}"`);
      } catch (err) {
        console.error(`[fail] ${entry.deck} "${prompt}":`, err);
        fail_++;
      }
    }

    console.log(
      `${entry.deck}: ${gen} generated, ${skip} skipped, ${fail_} failed`,
    );
    totalGen += gen;
    totalSkip += skip;
    totalFail += fail_;
  }

  console.log(
    `\ntotal: ${totalGen} generated, ${totalSkip} skipped, ${totalFail} failed`,
  );
  if (!args.dryRun) await buildLibraryManifests();
  process.exit(totalFail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("seed-library failed:", err);
  process.exit(1);
});
