#!/usr/bin/env bun
/**
 * Ingest a capture.json produced by the browser recorder into a finalized
 * demo manifest + locally-hosted keyframes.
 *
 * Usage:
 *   bun run apps/server/src/scripts/ingest-demo.ts <slug>
 *
 * Expects at apps/web/public/demos/<slug>/:
 *   - capture.json   (from the browser recorder, required)
 *   - manifest.json  (the stub with prompt/preset/source/etc., required)
 *   - audio.mp3      (required, just a sanity check)
 *
 * Produces:
 *   - 001.<ext>, 002.<ext>, …  (keyframe images, re-hosted from fal CDN)
 *   - manifest.json            (overwritten — frames + durationSec filled)
 *   - capture.json             (deleted on success)
 */

import { readFile, writeFile, unlink, access } from "node:fs/promises";
import { resolve as pathResolve } from "node:path";

import { DemoManifest } from "@sonara/shared";
import type { DemoFrame } from "@sonara/shared";

interface CaptureJson {
  slug: string;
  durationSec: number;
  frames: DemoFrame[];
}

// Map Content-Type to file extension. Defaults to .jpg.
function extFromContentType(ct: string | null): string {
  if (!ct) {
    return "jpg";
  }
  const t = ct.toLowerCase();
  if (t.includes("png")) {
    return "png";
  }
  if (t.includes("webp")) {
    return "webp";
  }
  if (t.includes("gif")) {
    return "gif";
  }
  return "jpg";
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const slug = process.argv[2];
  if (!slug) {
    console.error(
      "usage: bun run apps/server/src/scripts/ingest-demo.ts <slug>"
    );
    process.exit(1);
  }

  // apps/server/src/scripts → apps/server/src → apps/server → repo root → apps/web/public/demos/<slug>
  const demoDir = pathResolve(
    import.meta.dir,
    "../../../..",
    "apps/web/public/demos",
    slug
  );
  const capturePath = pathResolve(demoDir, "capture.json");
  const manifestPath = pathResolve(demoDir, "manifest.json");
  const audioPath = pathResolve(demoDir, "audio.mp3");

  for (const [label, p] of [
    ["capture.json", capturePath],
    ["manifest.json", manifestPath],
    ["audio.mp3", audioPath],
  ] as const) {
    if (!(await pathExists(p))) {
      console.error(`[ingest] missing ${label} at ${p}`);
      process.exit(1);
    }
  }

  const capture = JSON.parse(
    await readFile(capturePath, "utf-8")
  ) as CaptureJson;
  const manifestStub = JSON.parse(await readFile(manifestPath, "utf-8"));

  if (capture.slug !== slug) {
    console.error(
      `[ingest] slug mismatch: capture says "${capture.slug}", expected "${slug}"`
    );
    process.exit(1);
  }
  if (capture.frames.length === 0) {
    console.error("[ingest] capture.json has no frames; aborting");
    process.exit(1);
  }

  console.log(
    `[ingest] ${slug}: ${capture.frames.length} frames, ${capture.durationSec.toFixed(1)}s`
  );

  const localFrames: DemoFrame[] = [];
  for (let i = 0; i < capture.frames.length; i++) {
    const frame = capture.frames[i];
    if (!frame) {
      continue;
    }
    const idx = String(i + 1).padStart(3, "0");
    console.log(`[ingest]   [${idx}] t=${frame.t.toFixed(2)}s ← ${frame.url}`);
    const res = await fetch(frame.url);
    if (!res.ok) {
      console.error(`[ingest]   HTTP ${res.status} for ${frame.url}; aborting`);
      process.exit(1);
    }
    const ext = extFromContentType(res.headers.get("content-type"));
    const buf = new Uint8Array(await res.arrayBuffer());
    const localName = `${idx}.${ext}`;
    await writeFile(pathResolve(demoDir, localName), buf);
    localFrames.push({ t: frame.t, url: localName });
  }

  const finalManifest = {
    ...manifestStub,
    durationSec: capture.durationSec,
    frames: localFrames,
  };

  const parsed = DemoManifest.safeParse(finalManifest);
  if (!parsed.success) {
    console.error("[ingest] finalized manifest failed validation:");
    console.error(parsed.error.format());
    process.exit(1);
  }

  await writeFile(manifestPath, `${JSON.stringify(parsed.data, null, 2)}\n`);
  await unlink(capturePath);

  console.log(`[ingest] wrote ${manifestPath}`);
  console.log(`[ingest] deleted ${capturePath}`);
  console.log(`[ingest] done — ${localFrames.length} frames ingested`);
}

main().catch((error) => {
  console.error("[ingest] unexpected failure:", error);
  process.exit(1);
});
