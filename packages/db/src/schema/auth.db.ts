import {
  boolean,
  index,
  pgTable,
  text,
} from "drizzle-orm/pg-core";
import {
  type AccountId,
  type SessionId,
  type UserId,
  type VerificationId,
  typeIdGenerator,
} from "@sonara/shared/typeid";
import { baseEntityFields, createTimestampField, typeId } from "../utils";

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
  // Dodo Payments customer id. Lazily populated on first checkout.
  dodoCustomerId: text("dodo_customer_id"),
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
