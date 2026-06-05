import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { findPack } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";

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
 * subscriptions. Served by better-auth at /api/auth/dodopayments/webhook.
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
      if (meta.type !== "credit_pack") {
        return;
      }

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
            amountCents: pack.usd * 100,
            chainId: null,
            delta: pack.frames,
            id: typeIdGenerator("usageLedger"),
            kind: "topup",
            txHash: payload.data.payment_id,
            userId,
          });
          await tx
            .insert(SCHEMA.credits)
            .values({
              balanceFrames: pack.frames,
              id: typeIdGenerator("credits"),
              userId,
            })
            .onConflictDoUpdate({
              set: {
                balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${pack.frames}`,
                updatedAt: new Date(),
              },
              target: SCHEMA.credits.userId,
            });
        });
        console.info("[dodo-webhook] credited", {
          frames: pack.frames,
          packId,
          paymentId: payload.data.payment_id,
          userId,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
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
        throw error;
      }
    },
  };
}
