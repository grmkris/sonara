import type { Logger } from "../lib/logger";
import { debitFrame, refundFrame, tryConsumeFreeTier } from "./credits.service";

// Per-frame cost in the single `balance_frames` ledger. Anchor (the first
// frame of a session, runs on flux-2-pro/edit) is load-bearing for identity;
// flow frames edit that anchor on klein/9b.
export const COST_ANCHOR = 2;
export const COST_FLOW = 1;

// Hourly free-tier quota that fires only on flow frames once paid balance
// runs out. Anchor frames are too expensive to gift.
const FREE_TIER_HOURLY = 3;

// After the first "out of credits" denial on an auto-trigger (periodic /
// section), suppress further error toasts for this long before re-emitting.
// User-initiated triggers always emit.
export const CREDIT_DENIAL_COOLDOWN_MS = 60_000;

export interface CreditGateInput {
  userId: string;
  byokFalKey: string | null;
  /** Anchor frames cost more AND aren't free-tier eligible. */
  isAnchor: boolean;
  /** Voice / semantic / pause triggers. Bypasses the cooldown on the error toast. */
  isUserInitiated: boolean;
  lastCreditDenialAt: number;
  now: number;
  logger: Logger;
}

interface CreditGateOk {
  ok: true;
  /** Cost to refund on fal failure; null = no refund (free-tier or BYOK). */
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
 * Three branches:
 *   1. BYOK → always ok, paidCost=null (user pays fal directly).
 *   2. Paid debit succeeds → ok, paidCost = anchor|flow cost.
 *   3. Paid debit returns null → fall back to free-tier (flow only).
 *      If free-tier also denied → returns denial with cooldown-aware
 *      `shouldEmit`.
 *
 * Any exception inside debitFrame/tryConsumeFreeTier → `system_error`.
 */
export async function tryDebitCredit(
  input: CreditGateInput,
): Promise<CreditGateResult> {
  if (input.byokFalKey) {
    return { ok: true, paidCost: null, nextLastDenialAt: 0 };
  }

  const cost = input.isAnchor ? COST_ANCHOR : COST_FLOW;

  try {
    const remaining = await debitFrame(input.userId, cost, input.logger);
    if (remaining !== null) {
      input.logger.debug({ cost, remaining }, "credit debited");
      return { ok: true, paidCost: cost, nextLastDenialAt: 0 };
    }

    // Paid balance empty. Flow frames can fall back to the hourly free tier;
    // anchors cannot (too expensive to gift).
    if (!input.isAnchor) {
      const freeOk = await tryConsumeFreeTier(
        input.userId,
        FREE_TIER_HOURLY,
        input.logger,
      );
      if (freeOk) {
        input.logger.debug("free-tier slot consumed");
        return { ok: true, paidCost: null, nextLastDenialAt: 0 };
      }
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
 * Fire-and-forget refund after a fal generation fails. Free-tier and BYOK
 * paths pass `paidCost = null`; this function is a no-op for them. Errors
 * are logged but never propagated — refund failures shouldn't poison the
 * outer error path.
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
