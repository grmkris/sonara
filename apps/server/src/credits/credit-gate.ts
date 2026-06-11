import { FRAME_COST_CREDITS } from "@sonara/shared";

import type { Logger } from "../lib/logger";
import { debitFrame, refundFrame, tryConsumeFreeTier } from "./credits.service";

// Per-mode credit cost. Single source of truth lives in
// packages/shared/src/pricing.ts (FRAME_COST_CREDITS) so the UI and the
// server never disagree. Text-mode keyframes (klein/9b) cost 1 credit;
// model is heavier. Callers pass the relevant constant to tryDebitCredit
// via the optional `cost` field.
export const COST_PER_FRAME = FRAME_COST_CREDITS.text;

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
export const tryDebitCredit = async (
  input: CreditGateInput
): Promise<CreditGateResult> => {
  const cost = input.cost ?? COST_PER_FRAME;
  try {
    const remaining = await debitFrame(input.userId, cost, input.logger);
    if (remaining !== null) {
      input.logger.debug({ cost, remaining }, "credit debited");
      return { nextLastDenialAt: 0, ok: true, paidCost: cost };
    }

    const freeOk = await tryConsumeFreeTier(
      input.userId,
      FREE_TIER_HOURLY,
      input.logger
    );
    if (freeOk) {
      input.logger.debug("free-tier slot consumed");
      return { nextLastDenialAt: 0, ok: true, paidCost: null };
    }

    const shouldEmit =
      input.isUserInitiated ||
      input.now - input.lastCreditDenialAt > CREDIT_DENIAL_COOLDOWN_MS;
    return {
      nextLastDenialAt: shouldEmit ? input.now : input.lastCreditDenialAt,
      ok: false,
      reason: "out_of_credits",
      shouldEmit,
    };
  } catch (error) {
    input.logger.error({ error }, "credit gate errored");
    return {
      nextLastDenialAt: input.lastCreditDenialAt,
      ok: false,
      reason: "system_error",
      shouldEmit: true,
    };
  }
};

/**
 * Fire-and-forget refund after a fal generation fails. Free-tier paths pass
 * `paidCost = null`; this function is a no-op for them. Errors are logged
 * but never propagated — refund failures shouldn't poison the outer error
 * path.
 */
export const refundOnError = (
  userId: string,
  paidCost: number | null,
  logger: Logger
): void => {
  if (paidCost === null) {
    return;
  }
  // Intentionally fire-and-forget: this is a synchronous void helper called
  // from non-async error paths; awaiting would change its contract and the
  // caller's control flow. Errors are swallowed here by design.
  // oxlint-disable-next-line prefer-await-to-then, prefer-await-to-callbacks -- REVIEW: fire-and-forget void helper
  refundFrame(userId, paidCost, logger).catch((error) => {
    logger.error(
      { cost: paidCost, error },
      "refundFrame after fal error failed"
    );
  });
};
