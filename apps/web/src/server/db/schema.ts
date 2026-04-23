import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  type UserId,
  type SessionId,
  type AccountId,
  type VerificationId,
  type WalletAddressId,
  type CreditsId,
  type UsageLedgerId,
  typeIdGenerator,
} from "@/lib/typeid";
import { baseEntityFields, createTimestampField, typeId } from "./utils";

// Better Auth canonical tables, Drizzle-shaped with typeid ids. Columns
// store as `uuid` in Postgres; app code sees prefixed strings like
// `usr_01HJ...`. Field names (camelCase) are what Better Auth's drizzle
// adapter reads; SQL column names (snake_case) are Drizzle-internal.

export const user = pgTable("user", {
  id: typeId("user", "id")
    .primaryKey()
    .$defaultFn(() => typeIdGenerator("user"))
    .$type<UserId>(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  ...baseEntityFields,
});

export const session = pgTable(
  "session",
  {
    id: typeId("session", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("session"))
      .$type<SessionId>(),
    expiresAt: createTimestampField("expires_at").notNull(),
    token: text("token").notNull().unique(),
    ...baseEntityFields,
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = pgTable(
  "account",
  {
    id: typeId("account", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("account"))
      .$type<AccountId>(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: createTimestampField("access_token_expires_at"),
    refreshTokenExpiresAt: createTimestampField("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    ...baseEntityFields,
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

// verification uses $defaultFn(() => new Date()) instead of defaultNow() —
// matches groundtruth's production shape for Better Auth's SIWE nonce rows.
export const verification = pgTable(
  "verification",
  {
    id: typeId("verification", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("verification"))
      .$type<VerificationId>(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: createTimestampField("expires_at").notNull(),
    createdAt: createTimestampField("created_at").$defaultFn(() => new Date()),
    updatedAt: createTimestampField("updated_at").$defaultFn(() => new Date()),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const walletAddress = pgTable(
  "wallet_address",
  {
    id: typeId("walletAddress", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("walletAddress"))
      .$type<WalletAddressId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    address: text("address").notNull(),
    chainId: text("chain_id").notNull(),
    isPrimary: boolean("is_primary")
      .$defaultFn(() => false)
      .notNull(),
    ...baseEntityFields,
  },
  (table) => [
    index("wallet_address_user_id_idx").on(table.userId),
    uniqueIndex("wallet_address_address_idx").on(table.address),
  ],
);

// =====================================================================
// Credit ledger (Phase E). Atomic balance + append-only usage history.
// Frame cost model: `balance_frames` = flow-tier (every ~3s trigger).
// `balance_commits` = pro-tier (user-initiated). Debited per call in
// apps/server via direct pg SQL; see apps/server/src/credits/credits-service.ts.
// =====================================================================

export const credits = pgTable(
  "credits",
  {
    id: typeId("credits", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("credits"))
      .$type<CreditsId>(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    balanceFrames: integer("balance_frames").notNull().default(0),
    balanceCommits: integer("balance_commits").notNull().default(0),
    ...baseEntityFields,
  },
  (table) => [uniqueIndex("credits_user_id_idx").on(table.userId)],
);

// Append-only. `tx_hash` unique-where index is the idempotency guard against
// double-credit if Reown Pay fires onSuccess twice.
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
      enum: ["topup", "frame", "commit", "refund", "free"],
    }).notNull(),
    delta: integer("delta").notNull(),
    amountUsd: text("amount_usd"),
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
  ],
);

// Sliding hourly free-tier quota. Composite PK (user, window) collapses
// concurrent upserts onto a single row — race-safe without a transaction.
export const freeTierLedger = pgTable(
  "free_tier_ledger",
  {
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    windowStart: createTimestampField("window_start").notNull(),
    usageCount: integer("usage_count").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.windowStart] }),
  ],
);
