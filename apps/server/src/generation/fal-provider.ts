import { createFalClient } from "@fal-ai/client";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Two-mode generation pipeline.
//
//   anchor — runs the very first frame of a session. Uses flux-2-pro (text)
//            or flux-2-pro/edit (when album art is available as a seed).
//            The result is stored as heroImageUrl and locks identity for
//            the rest of the session.
//   flow   — every subsequent frame. Uses flux-2/klein/9b/edit with the
//            hero as reference. Klein's edit endpoint rejects num_inference_steps < 4.
//
// No text-only fallback. If anchor fails, the next periodic trigger retries
// while heroImageUrl is still null. If flow fails, the next periodic trigger
// retries with the same hero — superseded frames are aborted by the caller.

export type Mode = "anchor" | "flow";

export interface StreamPreviewInput {
  prompt: string;
  /** Reference image. For anchor: optional album art (acts as a seed). For flow: required hero. */
  referenceImage?: string;
  seed?: number;
  mode: Mode;
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

function resolveModel(mode: Mode, hasRef: boolean): string {
  if (mode === "anchor") {
    return hasRef ? env.FAL_ANCHOR_EDIT_MODEL : env.FAL_ANCHOR_TEXT_MODEL;
  }
  // Flow always edits the hero — there's no flow-text path.
  return env.FAL_FLOW_EDIT_MODEL;
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

  // Flow requires a reference (the hero). Calling flow without one is a bug
  // in the caller — surface it loudly instead of silently degrading.
  if (input.mode === "flow" && !hasRef) {
    input.onError(new Error("flow mode requires referenceImage (the session hero)"));
    return;
  }

  const model = resolveModel(input.mode, hasRef);

  // Payload schemas differ between tiers:
  //   anchor (flux-2-pro / flux-2-pro/edit) — "zero-config": rejects
  //     `num_inference_steps` and `num_images`. Pass only prompt, image_size,
  //     output_format, safety, seed?, image_urls?.
  //   flow (flux-2/klein/9b/edit) — accepts the extras; we tune steps for
  //     snappy keyframes.
  const payload: Record<string, unknown> = {
    prompt: input.prompt,
    image_size: "square_hd",
    output_format: "jpeg",
    enable_safety_checker: false,
  };
  if (input.mode === "flow") {
    payload.num_images = 1;
    payload.num_inference_steps = 4;
  }
  if (typeof input.seed === "number") payload.seed = input.seed;
  if (hasRef) payload.image_urls = [ref];

  input.logger.info(
    { model, mode: input.mode, hasRef },
    "fal subscribe start",
  );

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
      input.logger.warn({ model, mode: input.mode }, "fal returned no image");
      input.onError(new Error(`fal ${input.mode} returned no image`));
      return;
    }
    input.onPreview(url);
    input.onFinal(url);
    input.logger.info({ model, mode: input.mode, url }, "fal subscribe complete");
  } catch (err) {
    // Aborts are still routed through onError so the session can refund the
    // paid credit. The session distinguishes abort vs real error by inspecting
    // the controller's signal.
    if (!input.signal.aborted) {
      input.logger.warn({ err, model, mode: input.mode }, "fal generation errored");
    }
    input.onError(err);
  }
}
