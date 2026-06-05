import { typeIdGenerator } from "@sonara/shared/typeid";
import type { CreditsId, UsageLedgerId, UserId } from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseEntityFields, createTimestampField, typeId } from "../utils";
import { user } from "./auth.db";

// =====================================================================
// Credit ledger. Single `balance_frames` column — debited 1 per
// keyframe. Debited per call in apps/server via direct pg SQL; see
// apps/server/src/credits/credits.service.ts.
// =====================================================================

export const credits = pgTable(
  "credits",
  {
    balanceFrames: integer("balance_frames").notNull().default(0),
    id: typeId("credits", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("credits"))
      .$type<CreditsId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    ...baseEntityFields,
  },
  (table) => [uniqueIndex("credits_user_id_idx").on(table.userId)]
);

// Append-only. `tx_hash` unique-where index doubles as the idempotency guard
// for Dodo Payments webhook deliveries (storing `payment_id` in `tx_hash`).
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: typeId("usageLedger", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("usageLedger"))
      .$type<UsageLedgerId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    kind: text("kind", {
      enum: ["topup", "frame", "refund", "free"],
    }).notNull(),
    delta: integer("delta").notNull(),
    // Cents (USD smallest unit). Integer to match Dodo's wire format and
    // make SUM aggregates native. Nullable for non-money rows (frame
    // debits, refunds, free-tier writes).
    amountCents: integer("amount_cents"),
    txHash: text("tx_hash"),
    chainId: text("chain_id"),
    createdAt: createTimestampField("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("usage_ledger_user_id_idx").on(table.userId),
    index("usage_ledger_created_at_idx").on(table.createdAt),
    uniqueIndex("usage_ledger_tx_hash_idx")
      .on(table.txHash)
      .where(sql`${table.txHash} IS NOT NULL`),
  ]
);

// Sliding hourly free-tier quota. Composite PK (user, window) collapses
// concurrent upserts onto a single row — race-safe without a transaction.
export const freeTierLedger = pgTable(
  "free_tier_ledger",
  {
    usageCount: integer("usage_count").notNull().default(0),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    windowStart: createTimestampField("window_start").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.windowStart] })]
);
