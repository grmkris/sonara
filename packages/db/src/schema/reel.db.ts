import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  ReelFrameId,
  ReelId,
  UserId,
} from "@sonara/shared/typeid";
import { index, integer, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";
import { imageLibrary } from "./image-library.db";

// A **reel** is a user-curated, named, ordered collection of frames — the
// "groups" surfaced in /studio. Frames live once in `image_library` (the media
// store); a reel only *references* them via `reel_frame` (Photos→Albums model),
// never copies. A frame can appear in many reels.
//
// v1 reels are all user-curated. Live play "history" is still derived from
// image_library.session_id (see library.router.ts) and is NOT persisted here;
// unifying live runs into reels is a deliberate follow-up (it should adopt the
// durable room id from the rooms refactor rather than mint a competing one).
export const reel = pgTable(
  "reel",
  {
    // Optional thumbnail override. Falls back to the newest member frame when
    // null. set-null on frame delete so a removed cover doesn't dangle.
    coverFrameId: typeId("imageLibrary", "cover_frame_id")
      .references(() => imageLibrary.id, { onDelete: "set null" })
      .$type<ImageLibraryId>(),
    id: typeId("reel", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("reel"))
      .$type<ReelId>(),
    name: text("name").notNull(),
    userId: typeId("user", "user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    ...baseEntityFields,
  },
  (table) => [index("reel_user_created_idx").on(table.userId, table.createdAt.desc())]
);

// Ordered membership: one row per (reel, frame). `position` is the authored
// order within the reel. Deleting a reel cascades these; deleting a frame
// cascades the row out of every reel it was in.
export const reelFrame = pgTable(
  "reel_frame",
  {
    frameId: typeId("imageLibrary", "frame_id")
      .notNull()
      .references(() => imageLibrary.id, { onDelete: "cascade" })
      .$type<ImageLibraryId>(),
    id: typeId("reelFrame", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("reelFrame"))
      .$type<ReelFrameId>(),
    position: integer("position").notNull(),
    reelId: typeId("reel", "reel_id")
      .notNull()
      .references(() => reel.id, { onDelete: "cascade" })
      .$type<ReelId>(),
    ...baseEntityFields,
  },
  (table) => [
    // Authored order is unique within a reel (the reorder mutation maintains
    // this via an offset-bump transaction).
    uniqueIndex("reel_frame_reel_position_idx").on(table.reelId, table.position),
    // A frame appears at most once per reel in v1 — makes add/remove idempotent
    // and keyed by frameId rather than reelFrameId.
    uniqueIndex("reel_frame_reel_frame_idx").on(table.reelId, table.frameId),
    index("reel_frame_reel_idx").on(table.reelId),
  ]
);
