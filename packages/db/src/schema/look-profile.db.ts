import { typeIdGenerator } from "@sonara/shared/typeid";
import type { LookProfileId, UserId } from "@sonara/shared/typeid";
import type { LookConfig } from "@sonara/shared";
import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";

// A saved visual **look profile** — a named render config (the web
// PresetConfig: preset look + the Feel params) persisted per-account, so it can
// be recalled on any device and relayed to a screen. Mirrors the set model
// (owned, visibility-gated); `config` is the whole look as an opaque jsonb bag
// (validated via @sonara/shared LookConfig at the RPC boundary).
export const lookProfile = pgTable(
  "look_profile",
  {
    config: jsonb("config").notNull().$type<LookConfig>(),
    id: typeId("lookProfile", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("lookProfile"))
      .$type<LookProfileId>(),
    name: text("name").notNull(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    visibility: text("visibility", {
      enum: ["private", "unlisted", "public"],
    })
      .notNull()
      .default("private"),
    ...baseEntityFields,
  },
  (table) => [
    index("look_profile_user_created_idx").on(
      table.userId,
      table.createdAt.desc()
    ),
  ]
);
