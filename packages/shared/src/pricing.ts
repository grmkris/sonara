// Top-up pack catalogue. One source of truth for both client (<TopUpButton>
// shows the prices) and server (creates the Dodo checkout session for the
// right product).
//
// Cost model: every keyframe costs 1 credit. A 320-credit starter pack
// yields ~320 keyframes per session.

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
    id: "starter",
    usd: 10,
    frames: 320,
    productIdEnv: "DODO_PRODUCT_STARTER",
  },
  { id: "pro", usd: 30, frames: 960, productIdEnv: "DODO_PRODUCT_PRO" },
  { id: "max", usd: 100, frames: 3200, productIdEnv: "DODO_PRODUCT_MAX" },
] as const;

export function findPack(id: string): Pack | undefined {
  return PACKS.find((p) => p.id === id);
}

/**
 * Reverse-lookup a Pack from the Dodo product id observed in a webhook
 * payload. The webhook handler resolves the productId → packId via the
 * `metadata.packId` we set at checkout time, but this helper is the
 * fallback for diagnostic / audit code paths.
 */
export function resolveDodoProduct(
  productId: string,
  envMap: Record<DodoProductEnv, string>,
): Pack | undefined {
  return PACKS.find((p) => envMap[p.productIdEnv] === productId);
}
