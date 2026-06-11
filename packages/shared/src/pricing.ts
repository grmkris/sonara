// Top-up pack catalogue + per-frame cost model. One source of truth for both
// client and server (creates the Dodo checkout session; the credit gate
// debits the right amount).
//
// The cost model is uniform again: every keyframe — fresh t2i or chained
// image-to-image (klein/9b/edit conditions on the previous frame) — costs
// FRAME_COST_CREDITS.text. The 8-credit anchor tier died with flux-pro
// ultra; chained frames cost ~3.7× t2i at fal but still land far under one
// credit of revenue.
export const FRAME_COST_CREDITS = {
  text: 1,
} as const;

export type DodoProductEnv =
  | "DODO_PRODUCT_STARTER"
  | "DODO_PRODUCT_PRO"
  | "DODO_PRODUCT_MAX";

export interface Pack {
  /** Stable id used by both UI and server. Must be url-safe. */
  id: string;
  /** USD amount the user is asked to send. Display-only. */
  usd: number;
  /** Frames credited on `payment.succeeded` webhook. */
  frames: number;
  /** Env-var name on the server that holds the Dodo product id for this pack. */
  productIdEnv: DodoProductEnv;
}

export const PACKS: readonly Pack[] = [
  {
    frames: 320,
    id: "starter",
    productIdEnv: "DODO_PRODUCT_STARTER",
    usd: 10,
  },
  { frames: 960, id: "pro", productIdEnv: "DODO_PRODUCT_PRO", usd: 30 },
  { frames: 3200, id: "max", productIdEnv: "DODO_PRODUCT_MAX", usd: 100 },
] as const;

export const findPack = (id: string): Pack | undefined =>
  PACKS.find((p) => p.id === id);

/**
 * Reverse-lookup a Pack from the Dodo product id observed in a webhook
 * payload. The webhook handler resolves the productId → packId via the
 * `metadata.packId` we set at checkout time, but this helper is the
 * fallback for diagnostic / audit code paths.
 */
export const resolveDodoProduct = (
  productId: string,
  envMap: Record<DodoProductEnv, string>
): Pack | undefined => PACKS.find((p) => envMap[p.productIdEnv] === productId);
