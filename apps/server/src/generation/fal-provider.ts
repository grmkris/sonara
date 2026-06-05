import { createFalClient } from "@fal-ai/client";

import { env } from "../env";
import type { Logger } from "../lib/logger";

// Text-mode generation pipeline. Every text-mode keyframe goes through
// klein/9b text-to-image at a fixed 768² resolution. We don't use the
// `/edit` endpoint because (a) it bills 1 MP in + 1 MP out per frame
// (~3.7× pricier), and (b) reference-image identity-lock fights against
// prompt changes — when the user pivots subject mid-session we want the
// next frame to pivot too, not blend with the previous hero. Visual
// continuity comes from the client-side displacement shader + 60 fps
// feedback loop, not from server-side identity lock.
//
// A low-weight `image_prompt` reference is a SEPARATE code path in
// `anchor-provider.ts` — it engages only when the user explicitly uploads
// an image. The "no reference image" invariant above is specifically about
// `/edit`; the Redux-style image-prompt conditioning is a different fal
// surface with different cost trade-offs and explicit opt-in.

export interface StreamPreviewInput {
  prompt: string;
  seed?: number;
  signal: AbortSignal;
  logger: Logger;
  onPreview: (url: string) => void;
  onFinal: (url: string) => void;
  onError: (err: unknown) => void;
}

type FalClient = ReturnType<typeof createFalClient>;
type FalSubscriber = FalClient["subscribe"];

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

export async function streamPreview(input: StreamPreviewInput): Promise<void> {
  // Per-call scoped client. No global singleton — avoids cross-session
  // credential races under hot reload/test.
  const scoped = createFalClient({
    credentials: env.FAL_KEY,
  });
  const subscribe: FalSubscriber = scoped.subscribe.bind(scoped);

  const model = env.FAL_TEXT_MODEL;

  // 768² (0.59 MP) — billed at ~$0.0035/image vs ~$0.006 at square_hd (1 MP).
  // Klein/9b accepts any 64-aligned dimensions; 4 steps is the documented
  // minimum (tighter returns a 422).
  const payload: Record<string, unknown> = {
    enable_safety_checker: false,
    image_size: { height: 768, width: 768 },
    num_images: 1,
    num_inference_steps: 4,
    output_format: "jpeg",
    prompt: input.prompt,
  };
  if (typeof input.seed === "number") {
    payload.seed = input.seed;
  }

  input.logger.info({ model }, "fal subscribe start");

  try {
    const result = await subscribe(model, {
      abortSignal: input.signal,
      input: payload,
      logs: false,
      onQueueUpdate: (u) => {
        input.logger.debug({ model, status: u.status }, "fal queue update");
      },
    });
    if (input.signal.aborted) {
      input.onError(new DOMException("aborted", "AbortError"));
      return;
    }
    const url = extractImageUrl(result?.data);
    if (!url) {
      input.logger.warn({ model }, "fal returned no image");
      input.onError(new Error(`fal returned no image (model=${model})`));
      return;
    }
    input.onPreview(url);
    input.onFinal(url);
    input.logger.info({ model, url }, "fal subscribe complete");
  } catch (error) {
    // Aborts are still routed through onError so the session can refund the
    // paid credit. The session distinguishes abort vs real error by
    // inspecting the controller's signal.
    if (!input.signal.aborted) {
      input.logger.warn({ error, model }, "fal generation errored");
    }
    input.onError(error);
  }
}
