import { ORPCError } from "@music-visualizer/api/server";
import { findPack } from "@music-visualizer/shared";
import { and, eq, gte, sql, sum } from "drizzle-orm";
import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { z } from "zod";
import { typeIdGenerator } from "@/lib/typeid";
import { baseClient } from "@/lib/chain-clients";
import { SCHEMA } from "../db";
import { protectedProcedure } from "./procedures";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;
const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const ConfirmInput = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid txHash"),
  chainId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  packId: z.string().min(1),
});

export const creditsRouter = {
  getBalance: protectedProcedure.handler(async ({ context }) => {
    const { db, userId } = context;

    const balanceRow = await db
      .select({
        frames: SCHEMA.credits.balanceFrames,
        commits: SCHEMA.credits.balanceCommits,
      })
      .from(SCHEMA.credits)
      .where(eq(SCHEMA.credits.userId, userId))
      .limit(1);

    const balance = balanceRow[0] ?? { frames: 0, commits: 0 };

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
      commits: balance.commits,
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

      const recipientRaw = process.env.NEXT_PUBLIC_PAY_RECIPIENT_BASE;
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

      const expectedMin = BigInt(pack.usd) * 10n ** BigInt(USDC_DECIMALS);
      const usdcAddress = getAddress(USDC_BASE);
      let paidFrom: `0x${string}` | null = null;
      let paidValue = 0n;

      for (const log of receipt.logs) {
        if (getAddress(log.address) !== usdcAddress) continue;
        try {
          const decoded = decodeEventLog({
            abi: [TRANSFER_EVENT],
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName !== "Transfer") continue;
          const { from, to, value } = decoded.args;
          if (getAddress(to) !== recipient) continue;
          if (value < expectedMin) continue;
          paidFrom = getAddress(from);
          paidValue = value;
          break;
        } catch {
          // skip non-USDC logs
        }
      }

      if (!paidFrom) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            "no matching USDC Transfer found in this transaction (check recipient, amount, and chain)",
        });
      }

      try {
        await db.transaction(async (tx) => {
          await tx.insert(SCHEMA.usageLedger).values({
            id: typeIdGenerator("usageLedger"),
            userId,
            kind: "topup",
            delta: pack.frames + pack.commits,
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
              balanceCommits: pack.commits,
            })
            .onConflictDoUpdate({
              target: SCHEMA.credits.userId,
              set: {
                balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${pack.frames}`,
                balanceCommits: sql`${SCHEMA.credits.balanceCommits} + ${pack.commits}`,
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
        pack: { id: pack.id, frames: pack.frames, commits: pack.commits },
        txHash: input.txHash,
        paidFrom,
        paidValue: paidValue.toString(),
      };
    }),
};
