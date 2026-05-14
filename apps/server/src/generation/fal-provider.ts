import { createFalClient } from "@fal-ai/client";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Single-endpoint generation pipeline. Every keyframe goes through klein/9b
// text-to-image at a fixed 768² resolution. We don't use the /edit endpoint
// because (a) it bills 1 MP in + 1 MP out per frame (~3.7× pricier than
// text-to-image), and (b) reference-image identity-lock fights against
// prompt changes — when the user pivots subject mid-session we want the
// next frame to pivot too, not blend with the previous hero. Visual
// continuity comes from the client-side displacement shader + 60 fps
// feedback loop, not from server-side identity lock.

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
  if (!ev || typeof ev !== "object") return undefined;
  const e = ev as Partial<FalResult>;
  if (e.image?.url) return e.image.url;
  if (Array.isArray(e.images) && e.images[0]?.url) return e.images[0].url;
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
    prompt: input.prompt,
    num_images: 1,
    num_inference_steps: 4,
    image_size: { width: 768, height: 768 },
    output_format: "jpeg",
    enable_safety_checker: false,
  };
  if (typeof input.seed === "number") payload.seed = input.seed;

  input.logger.info({ model }, "fal subscribe start");

  try {
    const result = await subscribe(model, {
      input: payload,
      logs: false,
      abortSignal: input.signal,
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
  } catch (err) {
    // Aborts are still routed through onError so the session can refund the
    // paid credit. The session distinguishes abort vs real error by
    // inspecting the controller's signal.
    if (!input.signal.aborted) {
      input.logger.warn({ err, model }, "fal generation errored");
    }
    input.onError(err);
  }
}
