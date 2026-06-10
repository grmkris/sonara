import { typeIdGenerator } from "@sonara/shared/typeid";
import type { StageId, UserId } from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";

// A **stage** is the durable place an account performs at — the identity that
// /play, /control, and the crowd QR all resolve to. It owns nothing hot:
// live-run state (current lse_, crowd open/closed, attached screen) lives in
// the server registry; recordings reference the stage via frame_set.stage_id.
// See docs/rooms-and-roles-plan.md rev 2.
//
// Every account lazily gets one default stage ("Your stage") on first screen
// attach; extra stages are explicitly created + named. The `code` is the
// permanent 5-char Crockford join handle (URL + QR) — name is the label, code
// is the identity. Regenerating a leaked code is an owner action that keeps
// the row (and its history) intact.
export const stage = pgTable(
  "stage",
  {
    // Permanent join code (Crockford base32, no I/L/O/U/0/1). Minted
    // server-side; uniqueness enforced here, alphabet/length by the minter.
    code: text("code").notNull(),
    id: typeId("stage", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("stage"))
      .$type<StageId>(),
    // The lazily-created "Your stage" — bare /play and /control resolve to it.
    isDefault: boolean("is_default").notNull().default(false),
    name: text("name").notNull(),
    // Stages are always owned — anon performers get a registry-only pseudo
    // stage, never a row.
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    ...baseEntityFields,
  },
  (table) => [
    uniqueIndex("stage_code_idx").on(table.code),
    // At most one default stage per account.
    uniqueIndex("stage_user_default_idx")
      .on(table.userId)
      .where(sql`is_default`),
    index("stage_user_idx").on(table.userId),
  ]
);
