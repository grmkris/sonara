import { createFalClient } from "@fal-ai/client";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// FLUX.2 tier routing.
//
// Flow tier — runs on every periodic / semantic / section keyframe.
//   Default: klein 9B (measurably better preserve-most-of-input than 4B).
//   Edit variant for img2img continuity.
// Commit tier — runs only when the user explicitly commits (Enter / 印 button).
//   Default: flux-2-pro/edit (state-of-the-art multi-reference editor).
//   The commit frame becomes the hero that all subsequent flow frames edit on top of.
// Fallback — text-only last resort when both above 404/error.
const FLOW_TEXT_MODEL = env.FAL_TEXT_MODEL;
const FLOW_EDIT_MODEL = env.FAL_EDIT_MODEL;
const COMMIT_TEXT_MODEL = env.FAL_COMMIT_TEXT_MODEL;
const COMMIT_EDIT_MODEL = env.FAL_COMMIT_EDIT_MODEL;
const FALLBACK_TEXT_MODEL = "fal-ai/flux/schnell";

export interface StreamPreviewInput {
  prompt: string;
  referenceImages?: string[];
  seed?: number;
  forCommit?: boolean;
  // BYOK override — when set, fal calls are billed to the user's account
  // instead of ours.
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

interface SubscribeArgs {
  model: string;
  input: Record<string, unknown>;
  signal: AbortSignal;
  logger: Logger;
  onPreview: (url: string) => void;
  onFinal: (url: string) => void;
  tier: "flow" | "commit" | "fallback";
  subscribe: FalSubscriber;
}

async function subscribeOnce(args: SubscribeArgs): Promise<boolean> {
  args.logger.info(
    { model: args.model, tier: args.tier, hasRef: Boolean(args.input.image_urls) },
    "fal subscribe start",
  );

  const result = await args.subscribe(args.model, {
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
  args.logger.info({ model: args.model, tier: args.tier, url }, "fal subscribe complete");
  return true;
}

export async function streamPreview(input: StreamPreviewInput): Promise<void> {
  // Per-call scoped client. BYOK bills the user's fal account; otherwise the
  // platform key (env.FAL_KEY, required at startup) is used. No global
  // singleton — avoids cross-session credential races under hot reload/test.
  const scoped = createFalClient({
    credentials: input.falKey ?? env.FAL_KEY,
  });
  const subscribe = scoped.subscribe.bind(scoped);

  const refs = (input.referenceImages ?? []).filter(Boolean);
  const hasRef = refs.length > 0;

  const commonInput: Record<string, unknown> = {
    prompt: input.prompt,
    num_images: 1,
    num_inference_steps: hasRef ? 6 : 4,
    image_size: "square_hd",
    output_format: "jpeg",
    enable_safety_checker: false,
  };
  if (typeof input.seed === "number") commonInput.seed = input.seed;

  const [primaryEditModel, primaryTextModel]: [string, string] = input.forCommit
    ? [COMMIT_EDIT_MODEL, COMMIT_TEXT_MODEL]
    : [FLOW_EDIT_MODEL, FLOW_TEXT_MODEL];

  const primaryModel = hasRef ? primaryEditModel : primaryTextModel;
  const primaryInput = hasRef
    ? { ...commonInput, image_urls: refs }
    : commonInput;
  const tier: "flow" | "commit" = input.forCommit ? "commit" : "flow";

  try {
    const ok = await subscribeOnce({
      model: primaryModel,
      input: primaryInput,
      signal: input.signal,
      logger: input.logger,
      onPreview: input.onPreview,
      onFinal: input.onFinal,
      tier,
      subscribe,
    });
    if (ok || input.signal.aborted) return;
    input.logger.warn({ model: primaryModel, tier }, "primary returned no image");
  } catch (err) {
    if (input.signal.aborted) return;
    input.logger.warn({ err, model: primaryModel, tier }, "primary fal model errored");
    // Commit tier is the identity anchor — a schnell text-only stand-in would
    // replace the hero with a drifted frame every subsequent flow edit
    // compounds against. Better to surface the error than silently poison
    // the scene. Flow tier may still try the fallback.
    if (input.forCommit) {
      input.onError(err);
      return;
    }
  }

  // Commit-tier failures never fall through to the text-only path.
  if (input.forCommit) {
    input.onError(
      new Error("commit-tier primary model failed and fallback is disabled for commits"),
    );
    return;
  }

  // Flow-tier text-only fallback sheds identity (no image_urls). Logged loudly.
  if (hasRef) {
    input.logger.warn(
      { model: FALLBACK_TEXT_MODEL },
      "fallback is text-only; dropping reference image (identity will drift)",
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
      tier: "fallback",
      subscribe,
    });
  } catch (err2) {
    if (!input.signal.aborted) input.onError(err2);
  }
}

