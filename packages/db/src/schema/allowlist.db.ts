import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import {
  type AllowedEmailId,
  type UserId,
  typeIdGenerator,
} from "@sonara/shared/typeid";
import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";

// Email allowlist for emailAndPassword signup. A row here means the given
// email address is permitted to register an account via Better Auth's
// emailAndPassword flow. See `databaseHooks.user.create.before` in
// apps/web/src/server/auth.ts.
//
// Add with: `bun run --filter=web allow-email <address> [note]`.
export const allowedEmail = pgTable(
  "allowed_email",
  {
    id: typeId("allowedEmail", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("allowedEmail"))
      .$type<AllowedEmailId>(),
    // Stored lowercased and trimmed. The signup hook normalises before
    // comparing.
    email: text("email").notNull(),
    // Free-text note ("alpha tester", "investor"). Optional.
    note: text("note"),
    addedByUserId: typeId("user", "added_by_user_id")
      .references(() => user.id, { onDelete: "set null" })
      .$type<UserId>(),
    ...baseEntityFields,
  },
  (table) => [uniqueIndex("allowed_email_email_idx").on(table.email)],
);
