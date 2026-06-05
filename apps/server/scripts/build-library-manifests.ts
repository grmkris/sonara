#!/usr/bin/env bun
/**
 * Generate per-deck demo-frame manifests for the client-native demo loop.
 *
 * For each deck, lists apps/web/public/library/<deck>/*.webp and writes
 * apps/web/public/library/<deck>/manifest.json = { deck, frames: [urls] }.
 *
 * Source of truth is the committed images ON DISK (not the DB), so a manifest
 * can never list an image that wasn't committed — the exact failure we're
 * guarding against for offline playback. Output is deterministic (sorted), so
 * re-running produces no git diff unless the images actually changed.
 *
 * Run from apps/server/:  bun run build:manifests
 * Also invoked at the end of seed-library.ts so it can't drift from the images.
 */
import { readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DECK_KEYS } from "@sonara/shared";
import type { LibraryManifest } from "@sonara/shared";

function publicLibraryDir(): string {
  const here = import.meta.dirname;
  return resolve(here, "../../web/public/library");
}

export async function buildLibraryManifests(): Promise<void> {
  const baseDir = publicLibraryDir();
  for (const deck of DECK_KEYS) {
    const deckDir = resolve(baseDir, deck);
    let files: string[];
    try {
      files = await readdir(deckDir);
    } catch {
      // No directory for this deck yet — nothing to write into. Skip.
      continue;
    }
    const frames = files
      .filter((f) => f.endsWith(".webp"))
      .toSorted()
      .map((f) => `/library/${deck}/${f}`);
    const manifest: LibraryManifest = { deck, frames };
    await writeFile(
      resolve(deckDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    console.log(`  ${deck}: ${frames.length} frames`);
  }
}

// Run directly only when invoked as a script (not when imported by seed-library).
if (import.meta.main) {
  buildLibraryManifests()
    .then(() => console.log("library manifests written"))
    .catch((error) => {
      console.error("build-library-manifests failed:", error);
      process.exit(1);
    });
}
