import { SCHEMA } from "@sonara/db";
import type { UserId } from "@sonara/shared/typeid";
import { and, eq, gte, lt, sql } from "drizzle-orm";

import { getDb } from "../db/db";
import type { Logger } from "../lib/logger";

// Credit ledger access — drizzle over the shared db handle (getDb), in typeid
// space: every `userId` is the app-standard `usr_…` typeid and the schema's
// typeId columns translate it to the stored uuid for us. No raw SQL.

/**
 * Atomic decrement of `balance_frames` by `cost`. Returns the new balance if
 * the user had at least `cost` to spend, or `null` if insufficient. A
 * `usage_ledger` row is written in the same transaction for audit.
 *
 * Race-safe: the single UPDATE carries a `>= cost` guard, so concurrent
 * callers see either the decrement or a 0-row result (→ null), never a
 * double-spend. The ledger insert only happens when the debit succeeded.
 */
export const debitFrame = async (
  userId: UserId,
  cost: number,
  logger?: Logger
): Promise<number | null> => {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(SCHEMA.credits)
        .set({
          balanceFrames: sql`${SCHEMA.credits.balanceFrames} - ${cost}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(SCHEMA.credits.userId, userId),
            gte(SCHEMA.credits.balanceFrames, cost)
          )
        )
        .returning();
      if (!row) {
        return null;
      }
      await tx
        .insert(SCHEMA.usageLedger)
        .values({ delta: -cost, kind: "frame", userId });
      return row.balanceFrames;
    });
  } catch (error) {
    logger?.error({ cost, error, userId }, "debitFrame failed");
    throw error;
  }
};

/**
 * Inverse of `debitFrame`. Increments `balance_frames` by `cost` and appends a
 * `kind: "refund"` ledger row in the same transaction. Returns the new
 * balance, or `null` when the user has no `credits` row at all (caller treats
 * as a no-op).
 *
 * Use case: a fal generation fails after the credit was already debited.
 */
export const refundFrame = async (
  userId: UserId,
  cost: number,
  logger?: Logger
): Promise<number | null> => {
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(SCHEMA.credits)
        .set({
          balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${cost}`,
          updatedAt: new Date(),
        })
        .where(eq(SCHEMA.credits.userId, userId))
        .returning();
      if (!row) {
        return null;
      }
      await tx
        .insert(SCHEMA.usageLedger)
        .values({ delta: cost, kind: "refund", userId });
      return row.balanceFrames;
    });
  } catch (error) {
    logger?.error({ cost, error, userId }, "refundFrame failed");
    throw error;
  }
};

/**
 * Try to consume one free-tier slot in the current hourly window. Returns true
 * iff the user was under the hourly limit. Composite PK on
 * (user_id, window_start) makes this race-safe without an explicit tx —
 * concurrent callers upsert onto the same row and the conditional `setWhere`
 * gates the increment.
 *
 * `ON CONFLICT … DO UPDATE … WHERE usage_count < limit` returns NO row when the
 * predicate is false, so an empty result reads as "over quota". We also
 * re-check the returned count client-side as a second guard.
 */
export const tryConsumeFreeTier = async (
  userId: UserId,
  limitPerHour = 3,
  logger?: Logger
): Promise<boolean> => {
  const db = getDb();
  const rows = await db
    .insert(SCHEMA.freeTierLedger)
    .values({
      usageCount: 1,
      userId,
      windowStart: sql`date_trunc('hour', now())`,
    })
    .onConflictDoUpdate({
      set: { usageCount: sql`${SCHEMA.freeTierLedger.usageCount} + 1` },
      setWhere: lt(SCHEMA.freeTierLedger.usageCount, limitPerHour),
      target: [SCHEMA.freeTierLedger.userId, SCHEMA.freeTierLedger.windowStart],
    })
    .returning();
  const [row] = rows;
  if (!row || row.usageCount > limitPerHour) {
    return false;
  }
  // Append a 'free' row to the ledger for consistent usage analytics.
  try {
    await db
      .insert(SCHEMA.usageLedger)
      .values({ delta: -1, kind: "free", userId });
  } catch (error) {
    logger?.warn({ error, userId }, "failed to append free-tier ledger row");
  }
  return true;
};

export const getBalance = async (
  userId: UserId
): Promise<{ frames: number }> => {
  const db = getDb();
  const [row] = await db
    .select({ balanceFrames: SCHEMA.credits.balanceFrames })
    .from(SCHEMA.credits)
    .where(eq(SCHEMA.credits.userId, userId))
    .limit(1);
  return { frames: row?.balanceFrames ?? 0 };
};
