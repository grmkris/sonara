import type { Logger } from "../lib/logger";
import { debitFrame, refundFrame, tryConsumeFreeTier } from "./credits.service";

// Per-mode credit cost. Text-mode keyframes (klein/9b) cost 1 credit;
// image-anchor mode (flux-pro/v1.1-ultra) costs more because the underlying
// model is ~17× pricier. Callers pass the relevant constant to
// tryDebitCredit via the optional `cost` field.
export const COST_PER_FRAME = 1;
export const ANCHOR_FRAME_COST_CREDITS = 8;

// Hourly free-tier quota that fires when paid balance runs out. Applies to
// every trigger uniformly — there's no longer a "first frame too expensive
// to gift" exclusion.
const FREE_TIER_HOURLY = 3;

// After the first "out of credits" denial on an auto-trigger (periodic /
// section), suppress further error toasts for this long before re-emitting.
// User-initiated triggers always emit.
export const CREDIT_DENIAL_COOLDOWN_MS = 60_000;

export interface CreditGateInput {
  userId: string;
  /** Voice / semantic / pause triggers. Bypasses the cooldown on the error toast. */
  isUserInitiated: boolean;
  lastCreditDenialAt: number;
  now: number;
  logger: Logger;
  /** Per-frame credit cost. Defaults to text-mode COST_PER_FRAME. */
  cost?: number;
}

interface CreditGateOk {
  ok: true;
  /** Cost to refund on fal failure; null = no refund (free-tier consumed). */
  paidCost: number | null;
  /** Updated denial-timestamp; on success always 0 (denial state resets). */
  nextLastDenialAt: number;
}
interface CreditGateDenied {
  ok: false;
  reason: "out_of_credits" | "system_error";
  /** Whether the caller should emit a `job.status` error event (cooldown logic). */
  shouldEmit: boolean;
  nextLastDenialAt: number;
}

export type CreditGateResult = CreditGateOk | CreditGateDenied;

/**
 * Single entry point for the credit gate. Pure-function-shaped — returns a
 * result the caller writes back to its own state. Doesn't emit events or
 * mutate the Session.
 *
 * Two branches:
 *   1. Paid debit succeeds → ok, paidCost = COST_PER_FRAME.
 *   2. Paid debit returns null → fall back to free-tier.
 *      If free-tier also denied → returns denial with cooldown-aware
 *      `shouldEmit`.
 *
 * Any exception inside debitFrame/tryConsumeFreeTier → `system_error`.
 */
export async function tryDebitCredit(
  input: CreditGateInput,
): Promise<CreditGateResult> {
  const cost = input.cost ?? COST_PER_FRAME;
  try {
    const remaining = await debitFrame(
      input.userId,
      cost,
      input.logger,
    );
    if (remaining !== null) {
      input.logger.debug({ remaining, cost }, "credit debited");
      return { ok: true, paidCost: cost, nextLastDenialAt: 0 };
    }

    const freeOk = await tryConsumeFreeTier(
      input.userId,
      FREE_TIER_HOURLY,
      input.logger,
    );
    if (freeOk) {
      input.logger.debug("free-tier slot consumed");
      return { ok: true, paidCost: null, nextLastDenialAt: 0 };
    }

    const shouldEmit =
      input.isUserInitiated ||
      input.now - input.lastCreditDenialAt > CREDIT_DENIAL_COOLDOWN_MS;
    return {
      ok: false,
      reason: "out_of_credits",
      shouldEmit,
      nextLastDenialAt: shouldEmit ? input.now : input.lastCreditDenialAt,
    };
  } catch (err) {
    input.logger.error({ err }, "credit gate errored");
    return {
      ok: false,
      reason: "system_error",
      shouldEmit: true,
      nextLastDenialAt: input.lastCreditDenialAt,
    };
  }
}

/**
 * Fire-and-forget refund after a fal generation fails. Free-tier paths pass
 * `paidCost = null`; this function is a no-op for them. Errors are logged
 * but never propagated — refund failures shouldn't poison the outer error
 * path.
 */
export function refundOnError(
  userId: string,
  paidCost: number | null,
  logger: Logger,
): void {
  if (paidCost === null) return;
  refundFrame(userId, paidCost, logger).catch((err) => {
    logger.error(
      { err, cost: paidCost },
      "refundFrame after fal error failed",
    );
  });
}
