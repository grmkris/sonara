#!/usr/bin/env bun
/**
 * Grant credits to a user without going through the Dodo top-up path.
 * Useful for local development, QA fixtures, and one-off support actions.
 *
 * Usage:
 *   bun run apps/server/scripts/seed-credits.ts <userId> <frames>
 *
 * `userId` can be either a typeid (`usr_01HJ…`) or a raw UUID — the script
 * handles both. Updates `credits` if a row exists for the user, otherwise
 * inserts a fresh one. Always appends a `kind: "topup"` ledger row with the
 * exact delta granted, so the seed is auditable alongside real top-ups.
 *
 * Reads DATABASE_URL from `apps/server/.env`. Refuses to run with APP_ENV=
 * prod unless ALLOW_PROD_SEED=1 is set, since this writes real money.
 */

import { createDb, SCHEMA } from "@sonara/db";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import { typeIdGenerator } from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

function parseUserId(raw: string): string {
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  ) {
    return typeIdFromUuid("user", raw);
  }
  if (raw.startsWith("usr_")) {
    return raw;
  }
  return fail(`userId must be a typeid (usr_…) or a UUID — got "${raw}"`);
}

async function main() {
  const [userIdRaw, framesRaw] = process.argv.slice(2);
  if (!userIdRaw || !framesRaw) {
    fail(
      "usage: bun run apps/server/scripts/seed-credits.ts <userId> <frames>"
    );
  }
  const frames = Number(framesRaw);
  if (!Number.isInteger(frames) || frames < 0) {
    fail("frames must be a non-negative integer");
  }
  if (frames === 0) {
    fail("nothing to grant — frames is 0");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL not set — run from apps/server with .env in place");
  }

  if (process.env.APP_ENV === "prod" && process.env.ALLOW_PROD_SEED !== "1") {
    fail("refusing to seed in production — set ALLOW_PROD_SEED=1 to override");
  }

  const userId = parseUserId(userIdRaw);
  typeIdToUuid(userId as `usr_${string}`);

  const db = createDb(databaseUrl);

  await db.transaction(async (tx) => {
    await tx.insert(SCHEMA.usageLedger).values({
      amountCents: 0,
      chainId: null,
      delta: frames,
      id: typeIdGenerator("usageLedger"),
      kind: "topup",
      txHash: null,
      userId: userId as `usr_${string}`,
    });
    await tx
      .insert(SCHEMA.credits)
      .values({
        balanceFrames: frames,
        id: typeIdGenerator("credits"),
        userId: userId as `usr_${string}`,
      })
      .onConflictDoUpdate({
        set: {
          balanceFrames: sql`${SCHEMA.credits.balanceFrames} + ${frames}`,
          updatedAt: new Date(),
        },
        target: SCHEMA.credits.userId,
      });
  });

  console.log(`granted ${frames} frames to ${userId}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("seed-credits failed:", error);
  process.exit(1);
});
