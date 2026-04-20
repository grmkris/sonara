import { fal } from "@fal-ai/client";
import type { Logger } from "../lib/logger";

const FAL_KEY = process.env.FAL_KEY;
if (FAL_KEY) {
  fal.config({ credentials: FAL_KEY });
}

// FLUX.2 [klein] — sub-second image gen from Black Forest Labs, served by fal.
// Two endpoints:
//   - text-to-image:  fal-ai/flux-2/klein/4b
//   - edit / img2img: fal-ai/flux-2/klein/4b/edit  (takes image_urls array, up to 4)
// Env overrides keep us forward-compatible if BFL bumps model paths.
const TEXT_MODEL = process.env.FAL_TEXT_MODEL ?? "fal-ai/flux-2/klein/4b";
const EDIT_MODEL = process.env.FAL_EDIT_MODEL ?? "fal-ai/flux-2/klein/4b/edit";
// Fallback (text-only) for when the primary text model 404s.
const FALLBACK_TEXT_MODEL = "fal-ai/flux/schnell";

export interface StreamPreviewInput {
  prompt: string;
  referenceImages?: string[];
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
  if (!ev || typeof ev !== "object") return undefined;
  const e = ev as Partial<FalResult>;
  if (e.image?.url) return e.image.url;
  if (Array.isArray(e.images) && e.images[0]?.url) return e.images[0].url;
  return undefined;
}

interface SubscribeArgs {
  model: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  logger: Logger;
  onPreview: (url: string) => void;
  onFinal: (url: string) => void;
}

async function subscribeOnce(args: SubscribeArgs): Promise<boolean> {
  args.logger.info(
    { model: args.model, hasRef: Boolean(args.input.image_urls) },
    "fal subscribe start",
  );

  const result = await fal.subscribe(args.model, {
    input: args.input,
    logs: false,
    abortSignal: args.signal,
    onQueueUpdate: (u) => {
      args.logger.debug({ model: args.model, status: u.status }, "fal queue update");
    },
  });

  if (args.signal.aborted) return true;
  const url = extractImageUrl(result?.data);
  if (!url) return false;
  args.onPreview(url);
  args.onFinal(url);
  args.logger.info({ model: args.model, url }, "fal subscribe complete");
  return true;
}

export async function streamPreview(input: StreamPreviewInput): Promise<void> {
  if (!FAL_KEY) {
    input.onError(new Error("FAL_KEY not set"));
    return;
  }

  const refs = (input.referenceImages ?? []).filter(Boolean).slice(-4);
  const hasRef = refs.length > 0;

  // Seed pinning is the single most important lever for identity stability
  // across frames. With edit-endpoint + same seed + growing reference list,
  // the subject ("the cat") persists instead of re-rolling each generation.
  const commonInput: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: 1,
    num_inference_steps: hasRef ? 6 : 4,
    image_size: "square_hd",
    output_format: "jpeg",
    enable_safety_checker: false,
  };
  if (typeof input.seed === "number") commonInput.seed = input.seed;

  const primaryModel = hasRef ? EDIT_MODEL : TEXT_MODEL;
  const primaryInput = hasRef
    ? { ...commonInput, image_urls: refs }
    : commonInput;

  try {
    const ok = await subscribeOnce({
      model: primaryModel,
      input: primaryInput,
      signal: input.signal,
      logger: input.logger,
      onPreview: input.onPreview,
      onFinal: input.onFinal,
    });
    if (ok || input.signal.aborted) return;
    input.logger.warn({ model: primaryModel }, "primary returned no image; trying text fallback");
  } catch (err) {
    if (input.signal.aborted) return;
    input.logger.warn({ err, model: primaryModel }, "primary fal model errored; trying text fallback");
  }

  // Text-only fallback — used when the primary endpoint is unavailable.
  // Warn the caller that identity won't be preserved on this path.
  if (hasRef) {
    input.logger.warn(
      { model: FALLBACK_TEXT_MODEL },
      "fallback is text-only; dropping reference images (identity will drift)",
    );
  }
  try {
    await subscribeOnce({
      model: FALLBACK_TEXT_MODEL,
      input: commonInput,
      signal: input.signal,
      logger: input.logger,
      onPreview: input.onPreview,
      onFinal: input.onFinal,
    });
  } catch (err2) {
    if (!input.signal.aborted) input.onError(err2);
  }
}
