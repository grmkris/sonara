import type { TakeManifest } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  uuid,
} from "drizzle-orm/pg-core";

import { typeId } from "../utils";
import { frameSet } from "./frame-set.db";

export const performanceTake = pgTable("performance_take", {
  clientId: uuid("client_id").notNull().unique(),
  manifest: jsonb("manifest").$type<TakeManifest>(),
  setId: typeId("frameSet", "set_id")
    .primaryKey()
    .references(() => frameSet.id, { onDelete: "cascade" })
    .$type<FrameSetId>(),
});
export const performanceTakeChunk = pgTable(
  "performance_take_chunk",
  {
    bytes: integer("bytes").notNull(),
    contentType: text("content_type").notNull(),
    digest: text("digest").notNull(),
    index: integer("index").notNull(),
    key: text("key").notNull(),
    kind: text("kind", {
      enum: ["video", "audio", "events", "masks", "images"],
    }).notNull(),
    setId: typeId("frameSet", "set_id")
      .notNull()
      .references(() => performanceTake.setId, { onDelete: "cascade" })
      .$type<FrameSetId>(),
  },
  (table) => [primaryKey({ columns: [table.setId, table.kind, table.index] })]
);
