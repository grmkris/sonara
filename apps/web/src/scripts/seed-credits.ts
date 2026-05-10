#!/usr/bin/env bun
/**
 * Grant credits to a user without going through the on-chain top-up path.
 * Useful for local development (no real USDC required), QA fixtures, and
 * one-off support actions.
 *
 * Usage:
 *   bun run apps/web/src/scripts/seed-credits.ts <userId> <frames> [commits]
 *
 * `userId` can be either a typeid (`usr_01HJ…`) or a raw UUID — the script
 * handles both. Updates `credits` if a row exists for the user, otherwise
 * inserts a fresh one. Always appends a `kind: "topup"` ledger row with the
 * exact delta granted, so the seed is auditable alongside real top-ups.
 *
 * Reads DATABASE_URL from `apps/web/.env`. Refuses to run with NODE_ENV=
 * production unless ALLOW_PROD_SEED=1 is set, since this writes real money.
 */

import { sql } from "drizzle-orm";
import { typeIdFromUuid, typeIdToUuid } from "@music-visualizer/shared/typeid";
import { createDb, SCHEMA } from "@/server/db";
import { typeIdGenerator } from "@/lib/typeid";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseUserId(raw: string): string {
  // Accept either typeid form `usr_…` or a bare UUID.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) {
    return typeIdFromUuid("user", raw);
  }
  if (raw.startsWith("usr_")) return raw;
  return fail(`userId must be a typeid (usr_…) or a UUID — got "${raw}"`);
}

async function main() {
  const [userIdRaw, framesRaw, commitsRaw = "0"] = process.argv.slice(2);
  if (!userIdRaw || !framesRaw) {
    fail(
      "usage: bun run apps/web/src/scripts/seed-credits.ts <userId> <frames> [commits]",
    );
  }
  const frames = Number(framesRaw);
  const commits = Number(commitsRaw);
  if (!Number.isInteger(frames) || frames < 0) fail("frames must be a non-negative integer");
  if (!Number.isInteger(commits) || commits < 0) fail("commits must be a non-negative integer");
  if (frames === 0 && commits === 0) fail("nothing to grant — frames and commits both 0");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL not set — run from apps/web with .env in place");

  if (process.env.NODE_ENV === "production" && process.env.ALLOW_PROD_SEED !== "1") {
    fail("refusing to seed in production — set ALLOW_PROD_SEED=1 to override");
  }

  const userId = parseUserId(userIdRaw);
  // Sanity-check the typeid round-trips to a real UUID before touching the DB.
  typeIdToUuid(userId as `usr_${string}`);

  const db = createDb(databaseUrl);

  await db.transaction(async (tx) => {
    await tx.insert(SCHEMA.usageLedger).values({
      id: typeIdGenerator("usageLedger"),
      userId: userId as `usr_${string}`,
      kind: "topup",
      delta: frames + commits,
      amountUsd: "0",
      txHash: null,
      chainId: null,
    });
    await tx
      .insert(SCHEMA.credits)
      .values({
        id: typeIdGenerator("credits"),
        userId: userId as `usr_${string}`,
        balanceFrames: frames,
        balanceCommits: commits,
      })
      .onConflictDoUpdate({
        target: SCHEMA.credits.userId,
        set: {
          balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${frames}`,
          balanceCommits: sql`${SCHEMA.credits.balanceCommits} + ${commits}`,
          updatedAt: new Date(),
        },
      });
  });

  console.log(
    `granted ${frames} frames + ${commits} commits to ${userId}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("seed-credits failed:", err);
  process.exit(1);
});
