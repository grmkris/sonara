#!/usr/bin/env bun
/**
 * Chain-drift probe — the empirical gate for the frame-chaining redesign.
 * Runs sequential klein/9b/edit generations where each step conditions on the
 * PREVIOUS step's output (exactly what the live pipeline would do), and
 * writes every frame to /tmp/chain-probe/<arm>/ for eyeballing.
 *
 * Three arms:
 *   raw     — the comma-delimited scene-description prompt, drifting one
 *             modifier per step (mirrors serializeResolvedScene output).
 *   wrapped — same prompts behind an "evolve this image toward: …" wrapper.
 *   pivot   — raw prompts, with a hard subject change at step 6
 *             (koi pond → gothic cathedral) to test prompt-vs-image-prior.
 *
 * Usage (from apps/server): bun run scripts/probe-chain-drift.ts [steps]
 * Paid: ~3 arms × 12 steps × $0.006 ≈ $0.22 at 512².
 */

import { mkdir, writeFile } from "node:fs/promises";

import { createFalClient } from "@fal-ai/client";

import { env } from "../src/env";

const STEPS = Number(process.argv[2] ?? 12);
const SIZE = 512;
const OUT = "/tmp/chain-probe";
const fal = createFalClient({ credentials: env.FAL_KEY });

const DRIFT = [
  "soft morning haze",
  "gentle currents",
  "drifting petals",
  "long shadows",
  "rising mist",
  "amber undertones",
  "quiet ripples",
  "fading light",
  "first stars",
  "cool night air",
  "moonlit edges",
  "deep stillness",
];

const BASE =
  "a koi pond at dusk, ethereal watercolor ink wash, soft diffuse light, " +
  "low angle, shallow depth, dreamlike, serene, palette: #1a2a3a, #d98a4a, #f5efe0";

const PIVOT =
  "a gothic cathedral interior, shafts of colored light through stained glass, " +
  "ethereal watercolor ink wash, vast and reverent, palette: #1a1a2a, #8a4ad9, #f5efe0";

const promptFor = (arm: string, step: number): string => {
  const base = arm === "pivot" && step >= 6 ? PIVOT : BASE;
  const drift = DRIFT[step % DRIFT.length];
  const raw = `${base}, ${drift}`;
  return arm === "wrapped" ? `evolve this image toward: ${raw}` : raw;
};

const t2i = async (prompt: string): Promise<string> => {
  const r = await fal.subscribe("fal-ai/flux-2/klein/9b", {
    input: {
      enable_safety_checker: false,
      image_size: { height: SIZE, width: SIZE },
      num_images: 1,
      num_inference_steps: 4,
      output_format: "jpeg",
      prompt,
    },
    logs: false,
  });
  const data = r?.data as { images?: { url?: string }[] };
  const url = data?.images?.[0]?.url;
  if (!url) {
    throw new Error("t2i returned no image");
  }
  return url;
};

const edit = async (prevUrl: string, prompt: string): Promise<string> => {
  const r = await fal.subscribe("fal-ai/flux-2/klein/9b/edit", {
    input: {
      enable_safety_checker: false,
      image_size: { height: SIZE, width: SIZE },
      image_urls: [prevUrl],
      num_images: 1,
      num_inference_steps: 4,
      output_format: "jpeg",
      prompt,
    },
    logs: false,
  });
  const data = r?.data as { images?: { url?: string }[] };
  const url = data?.images?.[0]?.url;
  if (!url) {
    throw new Error("edit returned no image");
  }
  return url;
};

const save = async (arm: string, step: number, url: string): Promise<void> => {
  const res = await fetch(url);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await writeFile(`${OUT}/${arm}/${String(step).padStart(2, "0")}.jpg`, bytes);
};

for (const arm of ["raw", "wrapped", "pivot"]) {
  await mkdir(`${OUT}/${arm}`, { recursive: true });
  const t0 = Date.now();
  // Step 0 is a fresh t2i I-frame; everything after chains.
  let prev = await t2i(promptFor(arm, 0));
  await save(arm, 0, prev);
  for (let step = 1; step < STEPS; step += 1) {
    prev = await edit(prev, promptFor(arm, step));
    await save(arm, step, prev);
    process.stdout.write(`${arm} ${step}/${STEPS - 1}\r`);
  }
  console.log(
    `${arm}: ${STEPS} frames in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${OUT}/${arm}/`
  );
}
