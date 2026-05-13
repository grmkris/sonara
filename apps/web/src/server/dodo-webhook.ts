import { sql } from "drizzle-orm";
import { type Database, SCHEMA } from "@music-visualizer/db";
import { findPack } from "@music-visualizer/shared";
import { typeIdGenerator, type UserId } from "@music-visualizer/shared/typeid";

// Minimal payload shape we care about — Dodo's full PaymentSucceededPayload
// has many more fields. Typed loose because the plugin already validated it.
interface DodoPaymentPayload {
  data: {
    payment_id: string;
    total_amount?: number;
    metadata?: Record<string, unknown> | null;
  };
}

/**
 * Webhook handlers for the @dodopayments/better-auth `webhooks()` plugin.
 * Only `onPaymentSucceeded` is wired — we sell one-time credit packs, no
 * subscriptions.
 *
 * Idempotency: we store `payment_id` in `usage_ledger.tx_hash`. The partial
 * unique index `usage_ledger_tx_hash_idx WHERE tx_hash IS NOT NULL` makes
 * duplicate webhook deliveries no-ops.
 */
export function createDodoWebhookHandlers(props: { db: Database }) {
  const { db } = props;

  return {
    onPaymentSucceeded: async (payload: DodoPaymentPayload) => {
      const meta = payload.data.metadata ?? {};
      if (meta.type !== "credit_pack") return;

      const userIdRaw = typeof meta.userId === "string" ? meta.userId : null;
      const packId = typeof meta.packId === "string" ? meta.packId : null;
      if (!userIdRaw || !packId) {
        console.warn("[dodo-webhook] missing userId/packId in metadata", {
          paymentId: payload.data.payment_id,
        });
        return;
      }

      const pack = findPack(packId);
      if (!pack) {
        console.warn("[dodo-webhook] unknown packId", {
          packId,
          paymentId: payload.data.payment_id,
        });
        return;
      }

      const userId = userIdRaw as UserId;
      try {
        await db.transaction(async (tx) => {
          await tx.insert(SCHEMA.usageLedger).values({
            id: typeIdGenerator("usageLedger"),
            userId,
            kind: "topup",
            delta: pack.frames,
            amountUsd: pack.usd.toString(),
            txHash: payload.data.payment_id,
            chainId: null,
          });
          await tx
            .insert(SCHEMA.credits)
            .values({
              id: typeIdGenerator("credits"),
              userId,
              balanceFrames: pack.frames,
            })
            .onConflictDoUpdate({
              target: SCHEMA.credits.userId,
              set: {
                balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${pack.frames}`,
                updatedAt: new Date(),
              },
            });
        });
        console.info("[dodo-webhook] credited", {
          userId,
          packId,
          frames: pack.frames,
          paymentId: payload.data.payment_id,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Idempotency: a duplicate payment_id violates the partial unique
        // index on tx_hash. Treat as success.
        if (
          msg.includes("usage_ledger_tx_hash_idx") ||
          msg.includes("duplicate key")
        ) {
          console.info("[dodo-webhook] idempotent replay", {
            paymentId: payload.data.payment_id,
          });
          return;
        }
        console.error("[dodo-webhook] db write failed", { err: msg });
        throw err;
      }
    },
  };
}
