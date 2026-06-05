import { createFalClient } from "@fal-ai/client";

import { env } from "../env";
import type { Logger } from "../lib/logger";

// Image-anchor generation pipeline. Used when the live session has an
// `imageAnchor` set (user uploaded a reference image). Calls a different
// fal model than the text-mode pipeline — one that accepts an `image_url` +
// `image_prompt_strength` so the upload conditions the output.
//
// This is the SEPARATE code path from fal-provider.ts's text-to-image. The
// text path stays text-only by design (see fal-provider.ts header). Anchor
// mode debits at a higher credit rate (see credits/credit-gate.ts) to
// reflect the heavier model.

export interface StreamAnchorInput {
  prompt: string;
  imageUrl: string;
  strength: number;
  seed?: number;
  signal: AbortSignal;
  logger: Logger;
  onPreview: (url: string) => void;
  onFinal: (url: string) => void;
  onError: (err: unknown) => void;
}

interface FalImage {
  url: string;
}
interface FalResult {
  images?: FalImage[];
  image?: FalImage;
}

function extractImageUrl(ev: unknown): string | undefined {
  if (!ev || typeof ev !== "object") {
    return undefined;
  }
  const e = ev as Partial<FalResult>;
  if (e.image?.url) {
    return e.image.url;
  }
  if (Array.isArray(e.images) && e.images[0]?.url) {
    return e.images[0].url;
  }
  return undefined;
}

export async function streamAnchor(input: StreamAnchorInput): Promise<void> {
  // Per-call scoped client (same reasoning as fal-provider — avoid global
  // credential races under hot reload / parallel sessions).
  const scoped = createFalClient({
    credentials: env.FAL_KEY,
  });

  const model = env.FAL_ANCHOR_MODEL;

  // image_url + image_prompt_strength is the Redux-style conditioning that
  // flux-pro/v1.1-ultra accepts. Strength range is roughly 0.05–1.0; we
  // expose 3 preset values from the client (0.3 / 0.55 / 0.8).
  //
  // NOTE on the param names: this endpoint's schema uses `aspect_ratio` and
  // `safety_tolerance` — it does NOT honour `image_size` or
  // `enable_safety_checker` (those are the flux/dev schema and get silently
  // dropped here). We pin `aspect_ratio: "1:1"` so anchor frames match the
  // square text-mode frames (the default is 16:9, which both looked wrong in
  // the canvas and ~doubled the pixel count → WebGL texture/FPS pressure).
  // `safety_tolerance` lower = stricter; "2" is fal's own default for
  // user-facing surfaces and actually engages the output gate.
  const payload: Record<string, unknown> = {
    aspect_ratio: "1:1",
    image_prompt_strength: input.strength,
    image_url: input.imageUrl,
    num_images: 1,
    output_format: "jpeg",
    prompt: input.prompt,
    safety_tolerance: "2",
  };
  if (typeof input.seed === "number") {
    payload.seed = input.seed;
  }

  input.logger.info(
    { model, strength: input.strength },
    "anchor subscribe start"
  );

  try {
    const result = await scoped.subscribe(model, {
      abortSignal: input.signal,
      input: payload,
      logs: false,
      onQueueUpdate: (u) => {
        input.logger.debug({ model, status: u.status }, "anchor queue update");
      },
    });
    if (input.signal.aborted) {
      input.onError(new DOMException("aborted", "AbortError"));
      return;
    }
    const url = extractImageUrl(result?.data);
    if (!url) {
      input.logger.warn({ model }, "anchor returned no image");
      input.onError(new Error(`anchor returned no image (model=${model})`));
      return;
    }
    input.onPreview(url);
    input.onFinal(url);
    input.logger.info({ model, url }, "anchor subscribe complete");
  } catch (error) {
    if (!input.signal.aborted) {
      input.logger.warn({ error, model }, "anchor generation errored");
    }
    input.onError(error);
  }
}
