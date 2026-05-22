import { ORPCError } from "@sonara/api/server";
import { findPack } from "@sonara/shared";
import { and, eq, gte, sum } from "drizzle-orm";
import DodoPayments from "dodopayments";
import { z } from "zod";
import { env } from "@/env";
import { SCHEMA } from "@sonara/db";
import { protectedProcedure } from "./procedures";

let _dodo: DodoPayments | null = null;
function getDodoClient(): DodoPayments {
  if (_dodo) return _dodo;
  _dodo = new DodoPayments({
    bearerToken: env.DODO_PAYMENTS_API_KEY,
    environment: env.DODO_PAYMENTS_MODE,
  });
  return _dodo;
}

export const creditsRouter = {
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
          gte(SCHEMA.usageLedger.createdAt, monthStart),
        ),
      );

    const [spendRow] = await db
      .select({ totalCents: sum(SCHEMA.usageLedger.amountCents) })
      .from(SCHEMA.usageLedger)
      .where(
        and(
          eq(SCHEMA.usageLedger.userId, userId),
          eq(SCHEMA.usageLedger.kind, "topup"),
        ),
      );

    return {
      frames: balance.frames,
      monthFrames: Math.abs(Number(monthFramesRow?.total ?? 0)),
      totalSpentUsd: Number(spendRow?.totalCents ?? 0) / 100,
      lowBalance: balance.frames < 30,
    };
  }),

  /**
   * Create a Dodo Payments checkout session for the given pack and return
   * the hosted checkout URL. Client redirects to it; the user pays on
   * Dodo's page; on `payment.succeeded` the webhook handler credits frames
   * (see apps/web/src/server/dodo-webhook.ts).
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
          email: SCHEMA.user.email,
          name: SCHEMA.user.name,
          dodoCustomerId: SCHEMA.user.dodoCustomerId,
        })
        .from(SCHEMA.user)
        .where(eq(SCHEMA.user.id, userId))
        .limit(1);
      if (!u) throw new ORPCError("UNAUTHORIZED");

      const dodo = getDodoClient();

      // Lazy customer provisioning. New signups already have dodoCustomerId
      // (better-auth dodo plugin's createCustomerOnSignUp:true); this covers
      // pre-existing email/password users from before the plugin landed.
      let customerId = u.dodoCustomerId;
      if (!customerId) {
        const customer = await dodo.customers.create({
          email: u.email,
          name: u.name,
        });
        customerId = customer.customer_id;
        await db
          .update(SCHEMA.user)
          .set({ dodoCustomerId: customerId })
          .where(eq(SCHEMA.user.id, userId));
      }

      const session = await dodo.checkoutSessions.create({
        product_cart: [{ product_id: productId, quantity: 1 }],
        customer: { customer_id: customerId },
        metadata: {
          type: "credit_pack",
          userId,
          packId: pack.id,
        },
        return_url: `${env.APP_URL}/credits/success`,
      });

      if (!session.checkout_url) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Dodo returned no checkout URL",
        });
      }

      return { checkoutUrl: session.checkout_url };
    }),
};
