import { ORPCError } from "@music-visualizer/api/server";
import { findPack } from "@music-visualizer/shared";
import { and, eq, gte, sql, sum } from "drizzle-orm";
import { getAddress } from "viem";
import { z } from "zod";
import { publicEnv } from "@/env";
import { typeIdGenerator } from "@/lib/typeid";
import { baseClient } from "@/lib/chain-clients";
import { SCHEMA } from "@music-visualizer/db";
import { protectedProcedure } from "./procedures";
import { expectedMinForUsd, findUsdcTransfer } from "./topup-verifier";

const ConfirmInput = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid txHash"),
  chainId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  packId: z.string().min(1),
});

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
      .select({ total: sum(SCHEMA.usageLedger.amountUsd) })
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
      totalSpentUsd: Number(spendRow?.total ?? 0),
      lowBalance: balance.frames < 30,
    };
  }),

  confirmTopUp: protectedProcedure
    .input(ConfirmInput)
    .handler(async ({ input, context }) => {
      const { db, userId } = context;

      if (input.chainId !== 8453) {
        throw new ORPCError("BAD_REQUEST", {
          message: "only Base (chainId 8453) is supported",
        });
      }

      const pack = findPack(input.packId);
      if (!pack) {
        throw new ORPCError("BAD_REQUEST", { message: "unknown pack" });
      }

      const recipientRaw = publicEnv.NEXT_PUBLIC_PAY_RECIPIENT_BASE;
      if (!recipientRaw) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "NEXT_PUBLIC_PAY_RECIPIENT_BASE not set",
        });
      }
      let recipient: `0x${string}`;
      try {
        recipient = getAddress(recipientRaw);
      } catch {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "recipient env var is not a valid address",
        });
      }

      let receipt;
      try {
        receipt = await baseClient.getTransactionReceipt({
          hash: input.txHash as `0x${string}`,
        });
      } catch {
        throw new ORPCError("BAD_REQUEST", {
          message: "transaction not found or not yet mined",
        });
      }
      if (receipt.status !== "success") {
        throw new ORPCError("BAD_REQUEST", { message: "transaction reverted" });
      }

      const match = findUsdcTransfer(
        receipt.logs,
        recipient,
        expectedMinForUsd(pack.usd),
      );
      if (!match) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "no matching USDC Transfer found in this transaction (check recipient, amount, and chain)",
        });
      }
      const { paidFrom, paidValue } = match;

      try {
        await db.transaction(async (tx) => {
          await tx.insert(SCHEMA.usageLedger).values({
            id: typeIdGenerator("usageLedger"),
            userId,
            kind: "topup",
            delta: pack.frames,
            amountUsd: pack.usd.toString(),
            txHash: input.txHash,
            chainId: "8453",
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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes("usage_ledger_tx_hash_idx") ||
          msg.includes("duplicate key")
        ) {
          return { ok: true, idempotent: true } as const;
        }
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "db write failed",
        });
      }

      return {
        ok: true,
        pack: { id: pack.id, frames: pack.frames },
        txHash: input.txHash,
        paidFrom,
        paidValue: paidValue.toString(),
      };
    }),
};
