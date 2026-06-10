import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  FrameSetFrameId,
  FrameSetId,
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";
import { imageLibrary } from "./image-library.db";

// A **set** (frame_set) is the unified playable frame collection — the single
// entity behind what the UI used to split into built-in decks, session
// recordings, and curated reels. Frames live once in `image_library`; a set
// only *references* them via `frame_set_frame` (Photos→Albums model). `origin`
// says how the frame list got populated:
//
//   builtin    the shipped decks (NOIR, CYBER, …). System-owned (user_id
//              null), visibility public, deck_key set so the client can keep
//              playing them from the static /library manifests offline.
//   recording  auto-captured from a live performance. live_session_id links
//              back to the lse_ id; the set's uuid IS the lse uuid, so the
//              share permalink (/s/<set_id>) is derivable from a
//              liveSessionId without a round trip. Frame list freezes when
//              the show ends (status → final) — router-enforced, not a DB
//              constraint.
//   curated    hand-built ("make a cut"). The reel successor; legacy reels
//              were copied in (uuid = reel uuid) by migration 0006, which
//              then dropped the reel tables — old rel_ links still resolve.
export const frameSet = pgTable(
  "frame_set",
  {
    // Optional thumbnail override. Falls back to the first member frame when
    // null. set-null on frame delete so a removed cover doesn't dangle.
    coverFrameId: typeId("imageLibrary", "cover_frame_id")
      .references(() => imageLibrary.id, { onDelete: "set null" })
      .$type<ImageLibraryId>(),
    // Builtin sets only: which DeckKey this set mirrors. The client demo loop
    // keeps playing builtins from /library/{deck}/manifest.json (offline,
    // zero-backend) — the row exists for listing + permalinks.
    deckKey: text("deck_key"),
    // Denormalized member count, bumped on append and reconverged on boot —
    // saves a junction COUNT on every list().
    frameCount: integer("frame_count").notNull().default(0),
    id: typeId("frameSet", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("frameSet"))
      .$type<FrameSetId>(),
    // Recordings only: the live session that produced (or is producing) this
    // set. Matches image_library.session_id (a typeid string, not a FK).
    liveSessionId: text("live_session_id").$type<LiveSessionId>(),
    name: text("name").notNull(),
    origin: text("origin", {
      enum: ["builtin", "recording", "curated"],
    }).notNull(),
    // recording = a live performance is still appending frames; final =
    // frozen. Builtin/curated sets are always final.
    status: text("status", { enum: ["recording", "final"] })
      .notNull()
      .default("final"),
    // Null = system-owned (builtin sets).
    userId: typeId("user", "user_id")
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
    index("frame_set_user_created_idx").on(
      table.userId,
      table.createdAt.desc()
    ),
    // One recording set per live session — the converger and the live
    // recording path both upsert against this identity.
    uniqueIndex("frame_set_live_session_idx")
      .on(table.liveSessionId)
      .where(sql`live_session_id IS NOT NULL`),
    // One builtin set per deck.
    uniqueIndex("frame_set_deck_key_idx")
      .on(table.deckKey)
      .where(sql`origin = 'builtin'`),
  ]
);

// Ordered membership: one row per (set, frame). `position` is the play order.
// `t_ms` is the frame's offset from the performance start — present on
// recording members (preserves original replay timing), null on
// builtin/curated members (fixed-cadence loop).
export const frameSetFrame = pgTable(
  "frame_set_frame",
  {
    frameId: typeId("imageLibrary", "frame_id")
      .notNull()
      .references(() => imageLibrary.id, { onDelete: "cascade" })
      .$type<ImageLibraryId>(),
    id: typeId("frameSetFrame", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("frameSetFrame"))
      .$type<FrameSetFrameId>(),
    position: integer("position").notNull(),
    setId: typeId("frameSet", "set_id")
      .notNull()
      .references(() => frameSet.id, { onDelete: "cascade" })
      .$type<FrameSetId>(),
    tMs: integer("t_ms"),
    ...baseEntityFields,
  },
  (table) => [
    uniqueIndex("frame_set_frame_set_position_idx").on(
      table.setId,
      table.position
    ),
    // A frame appears at most once per set — makes add/remove idempotent and
    // keyed by frameId rather than the junction id.
    uniqueIndex("frame_set_frame_set_frame_idx").on(
      table.setId,
      table.frameId
    ),
    index("frame_set_frame_set_idx").on(table.setId),
  ]
);
