import { createFalClient } from "@fal-ai/client";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Single-endpoint generation pipeline. Klein/9b for every frame:
//   - First frame of a session → klein/9b text-to-image (no reference).
//     Session stores the resulting URL as `heroImageUrl` silently.
//   - Every subsequent frame → klein/9b/edit with the hero as `image_urls`.
//     Identity is locked via the reference image.
//
// Album art (when a song is identified) acts as an optional seed for the
// first frame — passed as `image_urls` so klein/9b/edit runs instead of
// text-to-image. The model's own first output then replaces it as the hero.

export interface StreamPreviewInput {
  prompt: string;
  /** Reference image. First frame: optional album art seed. Subsequent: the session hero. */
  referenceImage?: string;
  seed?: number;
  /** BYOK override — when set, fal calls are billed to the user's account instead of ours. */
  falKey?: string;
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
  // Per-call scoped client. BYOK bills the user's fal account; otherwise the
  // platform key is used. No global singleton — avoids cross-session
  // credential races under hot reload/test.
  const scoped = createFalClient({
    credentials: input.falKey ?? env.FAL_KEY,
  });
  const subscribe: FalSubscriber = scoped.subscribe.bind(scoped);

  const ref = input.referenceImage?.trim() || null;
  const hasRef = ref !== null;
  const model = hasRef ? env.FAL_EDIT_MODEL : env.FAL_TEXT_MODEL;

  // Klein/9b accepts num_inference_steps + num_images on both endpoints. 4
  // steps is klein's documented minimum; tighter than that returns a 422.
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: 1,
    num_inference_steps: 4,
    image_size: "square_hd",
    output_format: "jpeg",
    enable_safety_checker: false,
  };
  if (typeof input.seed === "number") payload.seed = input.seed;
  if (hasRef) payload.image_urls = [ref];

  input.logger.info({ model, hasRef }, "fal subscribe start");

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
