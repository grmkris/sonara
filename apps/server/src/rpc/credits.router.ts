import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import { dodoModeForEnv, findPack, SERVICE_URLS } from "@sonara/shared";
import DodoPayments from "dodopayments";
import { and, eq, gte, sum } from "drizzle-orm";
import { z } from "zod";

import { applyCreditTopUp, resolveTopUpPack } from "../auth/dodo-webhook";
import { env } from "../env";
import { protectedProcedure } from "./procedures";

let _dodo: DodoPayments | null = null;
const getDodoClient = (): DodoPayments => {
  if (_dodo) {
    return _dodo;
  }
  _dodo = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: dodoModeForEnv(env.APP_ENV),
  });
  return _dodo;
};

export const creditsRouter = {
  /**
   * Confirm-on-return: the /credits/success page hands us the `payment_id`
   * Dodo appended to the return_url and we reconcile server-side instead of
   * depending on webhook delivery timing. Retrieves the payment from Dodo
   * (trusted), verifies it belongs to the caller, and applies the credit
   * through the SAME ledger write as the webhook — tx_hash idempotency makes
   * the race between the two safe.
   */
  confirmTopUp: protectedProcedure
    .input(z.object({ paymentId: z.string().min(1).max(120) }))
    .handler(async ({ input, context }) => {
      const { db, userId } = context;
      const dodo = getDodoClient();

      let payment: Awaited<ReturnType<typeof dodo.payments.retrieve>>;
      try {
        payment = await dodo.payments.retrieve(input.paymentId);
      } catch {
        throw new ORPCError("NOT_FOUND", { message: "unknown payment" });
      }

      const [u] = await db
        .select({
          dodoCustomerId: SCHEMA.user.dodoCustomerId,
          email: SCHEMA.user.email,
        })
        .from(SCHEMA.user)
        .where(eq(SCHEMA.user.id, userId))
        .limit(1);
      if (!u) {
        throw new ORPCError("UNAUTHORIZED");
      }

      const ownsByMetadata = payment.metadata?.userId === userId;
      const ownsByCustomer =
        u.dodoCustomerId !== null &&
        u.dodoCustomerId === payment.customer.customer_id;
      const ownsByEmail =
        u.email.trim().toLowerCase() ===
        payment.customer.email.trim().toLowerCase();
      if (!(ownsByMetadata || ownsByCustomer || ownsByEmail)) {
        throw new ORPCError("FORBIDDEN", {
          message: "payment does not belong to this account",
        });
      }

      const status = payment.status ?? "processing";
      if (status !== "succeeded") {
        return { credited: false, frames: 0, status };
      }

      const pack = resolveTopUpPack(
        { ...payment, metadata: payment.metadata ?? {} },
        {
          DODO_PRODUCT_MAX: env.DODO_PRODUCT_MAX,
          DODO_PRODUCT_PRO: env.DODO_PRODUCT_PRO,
          DODO_PRODUCT_STARTER: env.DODO_PRODUCT_STARTER,
        }
      );
      if (!pack) {
        throw new ORPCError("BAD_REQUEST", {
          message: "payment is not a known credit pack",
        });
      }

      const outcome = await applyCreditTopUp(db, {
        pack,
        paymentId: payment.payment_id,
        userId,
      });
      console.info("[credits.confirmTopUp] applied", {
        outcome,
        packId: pack.id,
        paymentId: payment.payment_id,
        userId,
      });
      return { credited: true, frames: pack.frames, status };
    }),

  /**
   * Create a Dodo Payments checkout session for the given pack and return
   * the hosted checkout URL. Client redirects to it; the user pays on
   * Dodo's page; on `payment.succeeded` the webhook handler credits frames
   * (see apps/server/src/auth/dodo-webhook.ts).
   */
  createCheckout: protectedProcedure
    .input(z.object({ packId: z.string() }))
    .handler(async ({ input, context }) => {
      const { db, userId } = context;
      const pack = findPack(input.packId);
      if (!pack) {
        throw new ORPCError("BAD_REQUEST", { message: "unknown pack" });
      }
      const productId = env[pack.productIdEnv];

      const [u] = await db
        .select({
          dodoCustomerId: SCHEMA.user.dodoCustomerId,
          email: SCHEMA.user.email,
          name: SCHEMA.user.name,
        })
        .from(SCHEMA.user)
        .where(eq(SCHEMA.user.id, userId))
        .limit(1);
      if (!u) {
        throw new ORPCError("UNAUTHORIZED");
      }

      const dodo = getDodoClient();

      // Lazy customer provisioning — createCustomerOnSignUp is FALSE (signup
      // must not depend on Dodo availability), so every user gets their Dodo
      // customer created here on first checkout and persisted. The metadata
      // userId stamp gives webhooks a customer-level identity channel in
      // addition to the session metadata below.
      let customerId = u.dodoCustomerId;
      if (!customerId) {
        const customer = await dodo.customers.create({
          email: u.email,
          metadata: { userId },
          name: u.name,
        });
        customerId = customer.customer_id;
        await db
          .update(SCHEMA.user)
          .set({ dodoCustomerId: customerId })
          .where(eq(SCHEMA.user.id, userId));
      }

      const session = await dodo.checkoutSessions.create({
        customer: { customer_id: customerId },
        metadata: {
          packId: pack.id,
          type: "credit_pack",
          userId,
        },
        product_cart: [{ product_id: productId, quantity: 1 }],
        return_url: `${SERVICE_URLS[env.APP_ENV].web}/credits/success`,
      });

      if (!session.checkout_url) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Dodo returned no checkout URL",
        });
      }

      return { checkoutUrl: session.checkout_url };
    }),

  getBalance: protectedProcedure.handler(async ({ context }) => {
    const { db, userId } = context;

    const balanceRow = await db
      .select({ frames: SCHEMA.credits.balanceFrames })
      .from(SCHEMA.credits)
      .where(eq(SCHEMA.credits.userId, userId))
      .limit(1);

    const balance = balanceRow[0] ?? { frames: 0 };

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [monthFramesRow] = await db
      .select({ total: sum(SCHEMA.usageLedger.delta) })
      .from(SCHEMA.usageLedger)
      .where(
        and(
          eq(SCHEMA.usageLedger.userId, userId),
          eq(SCHEMA.usageLedger.kind, "frame"),
          gte(SCHEMA.usageLedger.createdAt, monthStart)
        )
      );

    const [spendRow] = await db
      .select({ totalCents: sum(SCHEMA.usageLedger.amountCents) })
      .from(SCHEMA.usageLedger)
      .where(
        and(
          eq(SCHEMA.usageLedger.userId, userId),
          eq(SCHEMA.usageLedger.kind, "topup")
        )
      );

    return {
      frames: balance.frames,
      lowBalance: balance.frames < 30,
      monthFrames: Math.abs(Number(monthFramesRow?.total ?? 0)),
      totalSpentUsd: Number(spendRow?.totalCents ?? 0) / 100,
    };
  }),
};
