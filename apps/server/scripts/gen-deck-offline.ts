#!/usr/bin/env bun
/**
 * DB-free deck generator. There is no local database in this project — dev and
 * prod each run their own Railway Postgres, and both converge to the committed
 * apps/server/scripts/library-seed.json on boot (see
 * apps/server/src/db/library-boot-seed.ts). So the way to add a deck to BOTH
 * environments identically is to generate its frames and append their rows to
 * library-seed.json, then commit. No DB connection required here.
 *
 * For each (deck, prompt) in library-manifest.json this calls fal once,
 * downloads the image, re-encodes to WebP under apps/web/public/library/<deck>/,
 * and appends an ExportRow to library-seed.json. Idempotent: prompts whose
 * (deck, prompt) hash is already in library-seed.json are skipped, so re-running
 * after a partial run only fills the gaps. Finishes by rebuilding the per-deck
 * static manifests from the images on disk.
 *
 * Usage (from apps/server):
 *   bun run scripts/gen-deck-offline.ts --deck noir
 *   bun run scripts/gen-deck-offline.ts --deck noir --limit 3
 *   bun run scripts/gen-deck-offline.ts --deck noir --dry-run
 *
 * Reads FAL_KEY + FAL_TEXT_MODEL from apps/server/.env. Does NOT touch any DB.
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createFalClient } from "@fal-ai/client";
import { DECK_KEYS } from "@sonara/shared";
import type { DeckKey } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import sharp from "sharp";

import { env } from "../src/env";
import { buildLibraryManifests } from "./build-library-manifests";

interface ManifestEntry {
  deck: DeckKey;
  prompts: string[];
}

// Mirrors apps/server/src/db/library-boot-seed.ts ExportRow.
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

interface Args {
  deck: DeckKey | null;
  limit: number | null;
  model: string;
  dryRun: boolean;
}

const fail = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const parseArgs = (): Args => {
  const argv = process.argv.slice(2);
  let deck: DeckKey | null = null;
  let limit: number | null = null;
  let model = env.FAL_TEXT_MODEL;
  let dryRun = false;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--deck") {
      i += 1;
      const v = argv[i];
      if (!v || !(DECK_KEYS as readonly string[]).includes(v)) {
        fail(`--deck must be one of: ${DECK_KEYS.join(", ")}`);
      }
      deck = v as DeckKey;
    } else if (a === "--limit") {
      i += 1;
      const v = Number(argv[i]);
      if (!Number.isInteger(v) || v <= 0) {
        fail("--limit must be a positive integer");
      }
      limit = v;
    } else if (a === "--model") {
      i += 1;
      model = argv[i] ?? fail("--model requires a value");
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      fail(`unknown arg: ${a}`);
    }
  }
  if (!deck) {
    fail("--deck is required");
  }
  return { deck, dryRun, limit, model };
};

const promptHash = (deck: string, prompt: string): string =>
  createHash("sha256").update(`${deck}::${prompt}`).digest("hex");

// Deterministic seed so re-generating a prompt yields a similar image.
const promptSeed = (prompt: string): number => {
  const h = createHash("sha256").update(prompt).digest();
  // oxlint-disable-next-line no-bitwise -- REVIEW: mask to a 31-bit positive seed
  return h.readUInt32BE(0) & 0x7f_ff_ff_ff;
};

interface FalImage {
  url: string;
  width?: number;
  height?: number;
}
interface FalData {
  images?: FalImage[];
  image?: FalImage;
}

const pickImage = (result: unknown): FalImage | null => {
  const data = (result as { data?: FalData } | undefined)?.data;
  if (!data) {
    return null;
  }
  if (data.image?.url) {
    return data.image;
  }
  if (data.images && data.images[0]?.url) {
    return data.images[0];
  }
  return null;
};

const scriptDir = (): string => import.meta.dirname;

// apps/server/scripts -> apps/web/public/library
const publicLibraryDir = (): string =>
  resolve(scriptDir(), "../../web/public/library");

const downloadAndEncode = async (
  url: string
): Promise<{ buffer: Buffer; width: number; height: number }> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed: ${res.status} ${res.statusText}`);
  }
  const raw = Buffer.from(await res.arrayBuffer());
  const out = await sharp(raw)
    .resize(1024, 1024, { fit: "cover" })
    .webp({ quality: 70 })
    .toBuffer({ resolveWithObject: true });
  return { buffer: out.data, height: out.info.height, width: out.info.width };
};

const main = async () => {
  const args = parseArgs();
  if (!env.FAL_KEY && !args.dryRun) {
    fail("FAL_KEY not set");
  }

  const manifestPath = resolve(scriptDir(), "library-manifest.json");
  const seedPath = resolve(scriptDir(), "library-seed.json");

  const manifest = JSON.parse(
    await Bun.file(manifestPath).text()
  ) as ManifestEntry[];
  const entry = manifest.find((m) => m.deck === args.deck);
  if (!entry) {
    fail(`no deck "${args.deck}" in library-manifest.json`);
  }

  const seed = JSON.parse(await Bun.file(seedPath).text()) as ExportRow[];
  const existing = new Set(seed.map((r) => r.promptHash));

  const fal = createFalClient({ credentials: env.FAL_KEY });
  const deckDir = resolve(publicLibraryDir(), args.deck as string);
  await mkdir(deckDir, { recursive: true });

  const prompts = args.limit
    ? (entry as ManifestEntry).prompts.slice(0, args.limit)
    : (entry as ManifestEntry).prompts;

  let gen = 0;
  let skip = 0;
  let failed = 0;

  for (const prompt of prompts) {
    const hash = promptHash(args.deck as string, prompt);
    if (existing.has(hash)) {
      skip += 1;
      continue;
    }

    if (args.dryRun) {
      console.log(`[dry-run] ${args.deck}: ${prompt}`);
      gen += 1;
      continue;
    }

    const id = typeIdGenerator("imageLibrary") as ImageLibraryId;
    const s = promptSeed(prompt);
    try {
      const result = await fal.subscribe(args.model, {
        input: {
          enable_safety_checker: false,
          image_size: "square_hd",
          num_images: 1,
          num_inference_steps: 4,
          output_format: "jpeg",
          prompt,
          seed: s,
        },
        logs: false,
      });
      const img = pickImage(result);
      if (!img) {
        console.warn(`[warn] ${args.deck} "${prompt}": no image from fal`);
        failed += 1;
        continue;
      }
      const { buffer, width, height } = await downloadAndEncode(img.url);
      const filename = `${id}.webp`;
      await writeFile(resolve(deckDir, filename), buffer);
      const url = `/library/${args.deck}/${filename}`;
      const row: ExportRow = {
        deck: args.deck as string,
        height,
        id,
        model: args.model,
        palette: null,
        prompt,
        promptHash: hash,
        seed: s,
        status: "active",
        url,
        width,
      };
      seed.push(row);
      existing.add(hash);
      // Persist after every image so a crash/cancel never loses generated work.
      await writeFile(seedPath, `${JSON.stringify(seed, null, 2)}\n`);
      gen += 1;
      console.log(`  + ${args.deck}/${filename}  "${prompt.slice(0, 60)}"`);
    } catch (error) {
      console.error(`[fail] ${args.deck} "${prompt}":`, error);
      failed += 1;
    }
  }

  console.log(
    `\n${args.deck}: ${gen} generated, ${skip} skipped, ${failed} failed`
  );
  if (!args.dryRun) {
    await buildLibraryManifests();
  }
  process.exit(failed > 0 ? 1 : 0);
};

try {
  await main();
} catch (error) {
  console.error("gen-deck-offline failed:", error);
  process.exit(1);
}
