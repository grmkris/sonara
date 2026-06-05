#!/usr/bin/env bun
/**
 * One-shot cleanup: delete users created by the now-removed SIWE flow.
 *
 * SIWE auto-created users with synthetic emails like `<address>@wallet.<host>`.
 * Wipe them + their cascade-linked rows (credits, usage_ledger,
 * free_tier_ledger, session, account). Also delete any leftover `account`
 * rows where `provider_id = 'siwe'` as defence in depth.
 *
 * Usage:
 *   bun run --filter=server purge-wallet-users
 */

import { createDb, SCHEMA } from "@sonara/db";
import { eq, like, sql } from "drizzle-orm";

const fail = (msg: string): never => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const main = async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    fail("DATABASE_URL not set — run from apps/server with .env in place");
  }
  const db = createDb(databaseUrl);

  // SIWE accounts (defence in depth — cascade from user.delete handles
  // them too, but if the user row was already replaced this catches strays).
  const siweAccounts = await db
    .delete(SCHEMA.account)
    .where(eq(SCHEMA.account.providerId, "siwe"))
    .returning();
  console.log(
    `deleted ${siweAccounts.length} account rows with providerId='siwe'`
  );

  // Wallet-synthetic users. Cascade kills credits/usageLedger/freeTierLedger/
  // session/account rows tied to the user id.
  const deleted = await db
    .delete(SCHEMA.user)
    .where(like(sql`lower(${SCHEMA.user.email})`, "%@wallet.%"))
    .returning();
  console.log(`deleted ${deleted.length} wallet-synthetic users`);
  for (const u of deleted) {
    console.log(`  - ${u.email}`);
  }
  process.exit(0);
};

try {
  await main();
} catch (error) {
  console.error("purge-wallet-users failed:", error);
  process.exit(1);
}
