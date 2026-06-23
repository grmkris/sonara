import type { Logger } from "../lib/logger";
import { streamPreview } from "./fal-provider";

// Shared t2i frame primitives used by the generation worker (and any future
// single-frame regenerate path): a deterministic seed + a promisified render.

// Render size — matches streamPreview's default (768², ~$0.0035/image).
export const FRAME_SIZE = 768;
// Nominal per-frame offset stamped on the image_library row (display metadata
// only; the curated timeline drives real playback timing via the look cadence
// and per-clip durations).
export const NOMINAL_FRAME_MS = 2000;

// Deterministic seed from (prompt, index) so a given spec renders reproducibly
// and the seeds are well-spread across the set. Plain multiplicative string
// hash kept positive + bounded by a per-step modulo (no bitwise — the lint
// preset forbids it and a real uint32 mix isn't needed; we only want a stable,
// spread integer).
const SEED_MODULO = 2_000_000_000;
export const seedFrom = (prompt: string, index: number): number => {
  let h = (2_166_136_261 + index * 16_777_619) % SEED_MODULO;
  for (let k = 0; k < prompt.length; k += 1) {
    h = (h * 31 + (prompt.codePointAt(k) ?? 0)) % SEED_MODULO;
  }
  return h;
};

// Promisify the callback-shaped streamPreview into "await one t2i url".
// streamPreview never rejects (it routes every failure — including abort —
// through onError), so resolving/rejecting from the callbacks is complete.
export const renderFrame = (args: {
  prompt: string;
  seed: number;
  signal: AbortSignal;
  logger: Logger;
}): Promise<string> =>
  // oxlint-disable-next-line promise/avoid-new -- promisify streamPreview's callback API (onFinal/onError) into a single awaitable url
  new Promise<string>((resolve, reject) => {
    let settled = false;
    void streamPreview({
      logger: args.logger,
      onError: (err) => {
        if (!settled) {
          settled = true;
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      onFinal: (url) => {
        if (!settled) {
          settled = true;
          resolve(url);
        }
      },
      // t2i: there's no distinct preview — onFinal carries the settled url.
      onPreview: () => {
        // intentionally ignored
      },
      prompt: args.prompt,
      seed: args.seed,
      signal: args.signal,
    });
  });
