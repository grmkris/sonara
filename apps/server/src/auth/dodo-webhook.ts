import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { findPack, resolveDodoProduct } from "@sonara/shared";
import type { DodoProductEnv, Pack } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { eq, sql } from "drizzle-orm";

// Minimal payload shape we care about — Dodo's full PaymentSucceededPayload
// has many more fields. Typed loose because the plugin already validated it.
interface DodoPaymentPayload {
  data: {
    payment_id: string;
    total_amount?: number;
    metadata?: Record<string, unknown> | null;
    customer?: {
      customer_id?: string;
      email?: string;
    } | null;
    product_cart?: { product_id: string; quantity?: number }[] | null;
  };
}

/**
 * Credit a pack purchase: one ledger row + balance upsert, in a transaction.
 * SHARED by the webhook handler and the confirm-on-return rpc route
 * (credits.confirmTopUp) so both race safely: `payment_id` is stored in
 * `usage_ledger.tx_hash` and the partial unique index
 * `usage_ledger_tx_hash_idx WHERE tx_hash IS NOT NULL` makes the second
 * writer a no-op ("duplicate").
 */
export const applyCreditTopUp = async (
  db: Database,
  args: { userId: UserId; pack: Pack; paymentId: string }
): Promise<"credited" | "duplicate"> => {
  const { userId, pack, paymentId } = args;
  try {
    await db.transaction(async (tx) => {
      await tx.insert(SCHEMA.usageLedger).values({
        amountCents: pack.usd * 100,
        chainId: null,
        delta: pack.frames,
        id: typeIdGenerator("usageLedger"),
        kind: "topup",
        txHash: paymentId,
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
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (
      msg.includes("usage_ledger_tx_hash_idx") ||
      msg.includes("duplicate key")
    ) {
      return "duplicate";
    }
    throw error;
  }
  return "credited";
};

/**
 * Resolve which pack a payment bought: `metadata.packId` (set by
 * credits.createCheckout) first, else reverse-lookup the cart's product id
 * against the per-env Dodo product ids. The cart fallback also filters out
 * OTHER brands' events — the Dodo account is shared across projects, so this
 * webhook can receive payments whose products we don't know; those resolve to
 * undefined and are ignored.
 */
export const resolveTopUpPack = (
  data: DodoPaymentPayload["data"],
  productEnvMap: Record<DodoProductEnv, string>
): Pack | undefined => {
  const packId =
    typeof data.metadata?.packId === "string" ? data.metadata.packId : null;
  if (packId) {
    return findPack(packId);
  }
  for (const line of data.product_cart ?? []) {
    const pack = resolveDodoProduct(line.product_id, productEnvMap);
    if (pack) {
      return pack;
    }
  }
  return undefined;
};

/**
 * Resolve the local user a payment belongs to. Order: `metadata.userId`
 * (stamped by credits.createCheckout) → `user.dodoCustomerId` (persisted at
 * lazy customer provisioning) → customer email, case-insensitive (the
 * checkout customer is created from the account email). Fallbacks exist so a
 * paid event is never silently dropped just because metadata went missing.
 */
export const resolveTopUpUser = async (
  db: Database,
  data: DodoPaymentPayload["data"]
): Promise<{ userId: UserId; via: string } | null> => {
  const metaUserId =
    typeof data.metadata?.userId === "string" ? data.metadata.userId : null;
  if (metaUserId) {
    return { userId: metaUserId as UserId, via: "metadata" };
  }

  const customerId = data.customer?.customer_id;
  if (customerId) {
    const [byCustomer] = await db
      .select({ id: SCHEMA.user.id })
      .from(SCHEMA.user)
      .where(eq(SCHEMA.user.dodoCustomerId, customerId))
      .limit(1);
    if (byCustomer) {
      return { userId: byCustomer.id as UserId, via: "dodoCustomerId" };
    }
  }

  const email = data.customer?.email?.trim().toLowerCase();
  if (email) {
    const [byEmail] = await db
      .select({ id: SCHEMA.user.id })
      .from(SCHEMA.user)
      .where(sql`lower(${SCHEMA.user.email}) = ${email}`)
      .limit(1);
    if (byEmail) {
      return { userId: byEmail.id as UserId, via: "email" };
    }
  }

  return null;
};

/**
 * Webhook handlers for the @dodopayments/better-auth `webhooks()` plugin.
 * Only `onPaymentSucceeded` is wired — we sell one-time credit packs, no
 * subscriptions. Served by better-auth at /api/auth/dodopayments/webhook.
 *
 * Idempotency: see applyCreditTopUp. The confirm-on-return route
 * (credits.confirmTopUp) shares the same write, so whichever of the two
 * lands first credits; the other is a no-op.
 */
export const createDodoWebhookHandlers = (props: {
  db: Database;
  productEnvMap: Record<DodoProductEnv, string>;
}) => {
  const { db, productEnvMap } = props;

  return {
    onPaymentSucceeded: async (payload: DodoPaymentPayload) => {
      const { data } = payload;
      const pack = resolveTopUpPack(data, productEnvMap);
      if (!pack) {
        // Not one of our packs — either another brand on the shared Dodo
        // account or an unknown product. Nothing to credit.
        if (data.metadata?.type === "credit_pack") {
          console.warn("[dodo-webhook] credit_pack payment with unknown pack", {
            paymentId: data.payment_id,
          });
        }
        return;
      }

      const resolved = await resolveTopUpUser(db, data);
      if (!resolved) {
        console.error("[dodo-webhook] could not map payment to a user", {
          customerId: data.customer?.customer_id,
          paymentId: data.payment_id,
        });
        return;
      }
      if (resolved.via !== "metadata") {
        console.warn("[dodo-webhook] user resolved via fallback", {
          paymentId: data.payment_id,
          userId: resolved.userId,
          via: resolved.via,
        });
      }

      try {
        const outcome = await applyCreditTopUp(db, {
          pack,
          paymentId: data.payment_id,
          userId: resolved.userId,
        });
        if (outcome === "duplicate") {
          console.info("[dodo-webhook] idempotent replay", {
            paymentId: data.payment_id,
          });
          return;
        }
        console.info("[dodo-webhook] credited", {
          frames: pack.frames,
          packId: pack.id,
          paymentId: data.payment_id,
          userId: resolved.userId,
          via: resolved.via,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error("[dodo-webhook] db write failed", { err: msg });
        throw error;
      }
    },
  };
};
