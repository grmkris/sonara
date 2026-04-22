import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { decodeEventLog, getAddress, parseAbiItem } from "viem";
import { z } from "zod";
import { findPack } from "@music-visualizer/shared";
import { env, publicEnv } from "@/env";
import { getAuth } from "@/server/auth";
import { baseClient } from "@/lib/chain-clients";
import { createDb, SCHEMA } from "@/server/db";
import { typeIdGenerator } from "@/lib/typeid";

// USDC on Base (native, issued by Circle).
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_DECIMALS = 6;

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

const BodySchema = z.object({
  txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid txHash"),
  chainId: z.union([z.string(), z.number()]).transform((v) => Number(v)),
  packId: z.string().min(1),
});

export async function POST(req: Request): Promise<Response> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { txHash, chainId, packId } = parsed.data;

  if (chainId !== 8453) {
    return NextResponse.json(
      { error: "only Base (chainId 8453) is supported" },
      { status: 400 },
    );
  }

  const pack = findPack(packId);
  if (!pack) {
    return NextResponse.json({ error: "unknown pack" }, { status: 400 });
  }

  const recipientRaw = publicEnv.NEXT_PUBLIC_PAY_RECIPIENT_BASE;
  if (!recipientRaw) {
    return NextResponse.json(
      { error: "NEXT_PUBLIC_PAY_RECIPIENT_BASE not set" },
      { status: 500 },
    );
  }
  let recipient: `0x${string}`;
  try {
    recipient = getAddress(recipientRaw);
  } catch {
    return NextResponse.json(
      { error: "recipient env var is not a valid address" },
      { status: 500 },
    );
  }

  // Fetch receipt. Throws if the tx doesn't exist or isn't mined — we treat
  // either as a 4xx from the client's perspective.
  let receipt;
  try {
    receipt = await baseClient.getTransactionReceipt({
      hash: txHash as `0x${string}`,
    });
  } catch {
    return NextResponse.json(
      { error: "transaction not found or not yet mined" },
      { status: 400 },
    );
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "transaction reverted" }, { status: 400 });
  }

  // Scan all logs for a USDC Transfer to the recipient with at least pack.usd.
  // "At least" not "exactly" — the wallet may pad slightly for rounding; any
  // overpayment still credits the pack. Users who underpay fail here.
  const expectedMin = BigInt(pack.usd) * 10n ** BigInt(USDC_DECIMALS);
  const usdcAddress = getAddress(USDC_BASE);
  let paidFrom: `0x${string}` | null = null;
  let paidValue: bigint = 0n;

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
      // Non-USDC-Transfer log — skip.
    }
  }

  if (!paidFrom) {
    return NextResponse.json(
      {
        error:
          "no matching USDC Transfer found in this transaction (check recipient, amount, and chain)",
      },
      { status: 400 },
    );
  }

  // Write ledger + upsert credits atomically. The unique index on tx_hash
  // (where tx_hash IS NOT NULL) prevents double-credit if this endpoint is
  // called twice with the same receipt.
  const db = createDb(env.DATABASE_URL);
  const userId = session.user.id as `usr_${string}`;

  try {
    await db.transaction(async (tx) => {
      await tx.insert(SCHEMA.usageLedger).values({
        id: typeIdGenerator("usageLedger"),
        userId,
        kind: "topup",
        delta: pack.frames + pack.commits,
        amountUsd: pack.usd.toString(),
        txHash,
        chainId: "8453",
      });
      // Upsert credits (user may not have a row yet).
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
    // Most likely a unique-constraint violation on tx_hash → idempotent replay.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("usage_ledger_tx_hash_idx") || msg.includes("duplicate key")) {
      return NextResponse.json(
        { ok: true, idempotent: true },
        { status: 200 },
      );
    }
    console.error("[credits/confirm] db write failed:", err);
    return NextResponse.json(
      { error: "internal error" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    pack: { id: pack.id, frames: pack.frames, commits: pack.commits },
    txHash,
    paidFrom,
    paidValue: paidValue.toString(),
  });
}
