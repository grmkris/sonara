import { typeIdGenerator } from "@sonara/shared/typeid";
import type { AllowedEmailId, UserId } from "@sonara/shared/typeid";
import { pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";

// Email allowlist. **Inert** since signup was opened (the public demo path
// landed and live-generation is gated by the credits ledger instead). The
// table is left in the schema as dead data so the migration history stays
// consistent; a follow-up migration can drop the table when we're confident
// the open-signup model is staying.
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
  (table) => [uniqueIndex("allowed_email_email_idx").on(table.email)]
);
