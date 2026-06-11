import { createFalClient } from "@fal-ai/client";

import { env } from "../env";
import type { Logger } from "../lib/logger";

// Queue-transport generation pipeline (klein/9b family). Two modes through
// ONE function:
//   t2i      no imageUrl — a fresh keyframe from the prompt + session seed.
//   chained  imageUrl set — the keyframe conditions on the previous frame
//            via the model's `/edit` endpoint (caller passes editFalId as
//            `model`), so consecutive frames genuinely evolve rather than
//            merely rhyme through the seed. Chain pacing and fresh-frame
//            ("I-frame") cadence live in the session (stability knob);
//            chained frames bill ~3.7× t2i at fal but still cost the same
//            one credit.

// Shared callback/lifecycle surface for both text-mode transports (this queue
// path and the realtime-provider websocket path). A frame stream takes a
// cancel signal + logger and reports through three callbacks: onPreview (an
// intermediate frame), onFinal (the settled frame), onError (failed OR
// superseded — the session refunds the credit either way and uses the signal
// to tell abort from a real error).
export interface FrameStreamCallbacks {
  signal: AbortSignal;
  logger: Logger;
  onPreview: (url: string) => void;
  onFinal: (url: string) => void;
  onError: (err: unknown) => void;
}

export interface StreamPreviewInput extends FrameStreamCallbacks {
  prompt: string;
  seed?: number;
  // fal endpoint id. Defaults to env.FAL_TEXT_MODEL when omitted (klein/9b).
  // For chained frames the caller passes the model's editFalId instead.
  model?: string;
  // Square render size. Defaults to 768² when omitted.
  size?: { width: number; height: number };
  // Chain conditioning: the previous on-screen frame. When set, the payload
  // carries image_urls=[imageUrl] (the /edit endpoint's plural input).
  imageUrl?: string;
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

const extractImageUrl = (ev: unknown): string | undefined => {
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
};

export const streamPreview = async (
  input: StreamPreviewInput
): Promise<void> => {
  // Per-call scoped client. No global singleton — avoids cross-session
  // credential races under hot reload/test.
  const scoped = createFalClient({
    credentials: env.FAL_KEY,
  });
  const subscribe: FalSubscriber = scoped.subscribe.bind(scoped);

  const model = input.model ?? env.FAL_TEXT_MODEL;
  const size = input.size ?? { height: 768, width: 768 };

  // 768² (0.59 MP) — billed at ~$0.0035/image vs ~$0.006 at square_hd (1 MP);
  // 512² roughly halves that again. Klein/9b accepts any 64-aligned dimensions;
  // 4 steps is the documented minimum (tighter returns a 422).
  const payload: Record<string, unknown> = {
    enable_safety_checker: false,
    image_size: { height: size.height, width: size.width },
    num_images: 1,
    num_inference_steps: 4,
    output_format: "jpeg",
    prompt: input.prompt,
  };
  if (typeof input.seed === "number") {
    payload.seed = input.seed;
  }
  if (input.imageUrl) {
    payload.image_urls = [input.imageUrl];
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
};
