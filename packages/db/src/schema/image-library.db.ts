import type { InspectorContext } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { baseEntityFields, typeId } from "../utils";
import { user } from "./auth.db";

// Every image that's ever rendered as a deck frame. Three sources:
//
//   - source = "seed":      pre-generated starter-deck images. Curated,
//                           shipped as static files under
//                           apps/web/public/library/<deck>/. user_id and
//                           session_id are null. Seeded by
//                           apps/server/scripts/seed-library.ts.
//
//   - source = "generated": frames produced by a live session and persisted
//                           via apps/server/src/library/persist-frame.ts.
//                           url is a Railway-bucket key; served via a
//                           presigned URL from the library router.
//
//   - source = "story":     reserved for Story-Mode autosaves. Same shape
//                           as "generated"; deck key is the user-named
//                           story id. position carries the authored order.
//
// Picker: apps/server/src/generation/library-provider.ts only ever returns
// source='seed' rows (so generated/story rows don't leak into starter
// playback). The library router returns the user's own generated/story
// rows for the timeline + gallery.
export const imageLibrary = pgTable(
  "image_library",
  // oxlint-disable-next-line sort-keys -- columns are grouped by concern (core / live-session / inspector) with field-specific doc comments; reordering would scramble the documentation, key order has no SQL effect
  {
    id: typeId("imageLibrary", "id")
      .primaryKey()
      .$defaultFn(() => typeIdGenerator("imageLibrary"))
      .$type<ImageLibraryId>(),
    deck: text("deck").notNull(),
    prompt: text("prompt").notNull(),
    // sha256(deck + "::" + prompt). Idempotency key for the seeder so
    // reruns skip rows that were already generated. Unique ONLY among
    // source='seed' rows (live-generated frames can share a prompt across
    // sessions).
    promptHash: text("prompt_hash").notNull(),
    model: text("model").notNull(),
    seed: integer("seed"),
    // For source='seed': relative path under apps/web/public (e.g.
    // "/library/wild/abc.webp"). For source='generated'|'story': a key in
    // the Railway bucket (e.g. "generated/<user-id>/<typeid>.webp"). The
    // library router computes a presigned absolute URL on read.
    url: text("url").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    palette: text("palette").array(),
    status: text("status", { enum: ["active", "rejected"] })
      .notNull()
      .default("active"),

    // --- Live-session ownership ---

    source: text("source", { enum: ["seed", "generated", "story"] })
      .notNull()
      .default("seed"),
    userId: typeId("user", "user_id")
      .references(() => user.id, { onDelete: "cascade" })
      .$type<UserId>(),
    sessionId: text("session_id").$type<LiveSessionId>(),
    // Milliseconds since the session's sessionStartAt (for source='generated')
    // or since the authored story's t=0 (for source='story'). Null for seed.
    tMs: integer("t_ms"),
    // Reserved for explicit Story-Mode authoring order. Null for seed and
    // live-generated rows; populated when a story deck is saved.
    position: integer("position"),
    // Original fal.ai CDN URL kept for forensics / refund flows. Never
    // served to clients (fal URLs are ephemeral; the bucket copy is
    // canonical).
    sourceUrl: text("source_url"),

    // --- /studio inspector context ---
    // (All nullable — historical rows pre-/studio carry NULL here and the
    // inspector renders "no context recorded" for them.)

    // Why trigger() fired: 'periodic' | 'semantic' | 'section' | 'pause' |
    // 'voice'. Surfaces user intent in the inspector ("you spoke" /
    // "section change"). Untyped at the DB level — the server's
    // TriggerSource enum is the source of truth.
    triggerReason: text("trigger_reason"),
    // When this frame was anchor-mode: the input image URL (a presigned
    // bucket URL OR a fal.storage user-upload URL). Null for text-mode.
    // Display-only; we don't trace back to the source library row in v1.
    anchorUrl: text("anchor_url"),
    // jsonb bag of display metadata: audio mood, nowPlaying track, drift
    // modifier, resolved-scene summary. Schema in
    // packages/shared/src/inspector-context.ts. Evolves without migrations.
    inspectorContext: jsonb("inspector_context").$type<InspectorContext>(),

    ...baseEntityFields,
  },
  (table) => [
    index("image_library_deck_status_idx").on(table.deck, table.status),
    // Seeder idempotency — partial unique so only seed rows participate.
    uniqueIndex("image_library_prompt_hash_idx")
      .on(table.promptHash)
      .where(sql`source = 'seed'`),
    // Per-user gallery (newest first).
    index("image_library_user_created_idx")
      .on(table.userId, table.createdAt.desc())
      .where(sql`source = 'generated' OR source = 'story'`),
    // Per-session timeline (oldest first).
    index("image_library_session_tms_idx")
      .on(table.sessionId, table.tMs)
      .where(sql`session_id IS NOT NULL`),
  ]
);
