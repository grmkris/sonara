import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { DECKS, DECK_LOOK, isDeckUnlisted } from "@sonara/shared";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";

import type { Logger } from "../lib/logger";
import { getDb } from "./db";

// Idempotent converger of the legacy two-concept world (built-in decks,
// derived sessions) into the unified frame_set tables. Runs on every server
// boot after migrations + the library seed — same rationale: prod and any
// fresh DB converge to the same state with no manual railway-run.
//
// drizzle over the shared db handle, in typeid space. The two irreducibly
// SQL-shaped statements (the row_number() INSERT…SELECT seedings and the
// UPDATE…FROM count reconverge) run via db.execute(sql`…`) — still the one
// typed handle, no raw pg pool.
//
// Idempotency comes from deterministic ids + ON CONFLICT DO NOTHING:
//   builtin    one set per DeckKey, guarded by the partial unique index on
//              (deck_key) WHERE origin='builtin'.
//   recording  set uuid = the lse_ typeid's uuid, so re-deriving from the
//              same session always hits the same row — and a share permalink
//              (/s/<set_id>) is computable from a liveSessionId alone.
export const migrateFrameSetsOnBoot = async (
  logger: Logger,
  db: Database = getDb()
): Promise<void> => {
  let builtins = 0;
  let recordings = 0;

  // 1) Built-in decks → builtin sets (one per DeckKey, system-owned).
  // Boot convergence is intentionally sequential: each deck/session does
  // ordered, dependent queries (insert the set → update it → populate frames),
  // and serial execution bounds DB load at startup.
  /* oxlint-disable no-await-in-loop */
  for (const deck of DECKS) {
    const visibility = isDeckUnlisted(deck.key) ? "unlisted" : "public";

    const insertedBuiltin = await db
      .insert(SCHEMA.frameSet)
      .values({
        deckKey: deck.key,
        name: deck.label,
        origin: "builtin",
        status: "final",
        userId: null,
        visibility,
      })
      .onConflictDoNothing({
        target: SCHEMA.frameSet.deckKey,
        where: eq(SCHEMA.frameSet.origin, "builtin"),
      })
      .returning();
    builtins += insertedBuiltin.length;

    // Re-converge visibility (a deck's listing flag may have changed).
    await db
      .update(SCHEMA.frameSet)
      .set({ visibility })
      .where(
        and(
          eq(SCHEMA.frameSet.origin, "builtin"),
          eq(SCHEMA.frameSet.deckKey, deck.key),
          ne(SCHEMA.frameSet.visibility, visibility)
        )
      );

    // Re-converge the baked look from DECK_LOOK + the style drift from
    // DECKS[].style — shared code stays the source of truth for builtins.
    // Decks WITHOUT a DECK_LOOK entry keep null look columns. The null-safe
    // IS DISTINCT FROM guard avoids a no-op write when nothing drifted.
    const look = DECK_LOOK[deck.key] ?? null;
    const preset = look?.preset ?? null;
    const intensity = look?.intensity ?? null;
    const calm = look?.cadence.calm ?? null;
    const loud = look?.cadence.loud ?? null;
    await db
      .update(SCHEMA.frameSet)
      .set({
        lookCadenceCalmMs: calm,
        lookCadenceLoudMs: loud,
        lookIntensity: intensity,
        lookPreset: preset,
        styleDrift: deck.style,
      })
      .where(
        and(
          eq(SCHEMA.frameSet.origin, "builtin"),
          eq(SCHEMA.frameSet.deckKey, deck.key),
          sql`(look_preset IS DISTINCT FROM ${preset}
            OR look_intensity IS DISTINCT FROM ${intensity}
            OR look_cadence_calm_ms IS DISTINCT FROM ${calm}
            OR look_cadence_loud_ms IS DISTINCT FROM ${loud}
            OR style_drift IS DISTINCT FROM ${deck.style})`
        )
      );

    // Seed the builtin set's frames (row_number positioning, append past the
    // current max). Bare ON CONFLICT covers both junction unique indexes.
    await db.execute(sql`
      INSERT INTO frame_set_frame (id, set_id, frame_id, position, t_ms)
      SELECT gen_random_uuid(), fs.id, il.id,
             row_number() OVER (ORDER BY il.id) - 1
               + COALESCE((SELECT max(f.position) + 1 FROM frame_set_frame f
                           WHERE f.set_id = fs.id), 0),
             NULL
      FROM image_library il
      CROSS JOIN (SELECT id FROM frame_set
                  WHERE origin = 'builtin' AND deck_key = ${deck.key}) fs
      WHERE il.deck = ${deck.key} AND il.source = 'seed' AND il.status = 'active'
      ON CONFLICT DO NOTHING`);
  }

  // 2) Legacy live-play history (derived sessions) → recording sets. drizzle
  // returns user_id as the typeid; session_id is the lse typeid (text).
  const sessions = await db
    .select({
      firstAt: sql<Date>`min(${SCHEMA.imageLibrary.createdAt})`,
      sessionId: SCHEMA.imageLibrary.sessionId,
      userId: SCHEMA.imageLibrary.userId,
    })
    .from(SCHEMA.imageLibrary)
    .where(
      and(
        inArray(SCHEMA.imageLibrary.source, ["generated", "story"]),
        isNotNull(SCHEMA.imageLibrary.sessionId),
        isNotNull(SCHEMA.imageLibrary.userId)
      )
    )
    .groupBy(SCHEMA.imageLibrary.sessionId, SCHEMA.imageLibrary.userId);

  for (const row of sessions) {
    const { sessionId, userId } = row;
    // The isNotNull filters guarantee these at runtime; narrow for TS.
    if (!(sessionId && userId)) {
      continue;
    }
    const setUuid = typeIdToUuid(sessionId).uuid;
    const name = new Date(row.firstAt)
      .toISOString()
      .slice(0, 16)
      .replace("T", " · ");

    const insertedRecording = await db
      .insert(SCHEMA.frameSet)
      .values({
        createdAt: new Date(row.firstAt),
        id: typeIdFromUuid("frameSet", setUuid),
        liveSessionId: sessionId,
        name,
        origin: "recording",
        status: "final",
        userId,
        visibility: "private",
      })
      .onConflictDoNothing({ target: SCHEMA.frameSet.id })
      .returning();
    recordings += insertedRecording.length;

    // Backfill the recording's frames in timeline order.
    await db.execute(sql`
      INSERT INTO frame_set_frame (id, set_id, frame_id, position, t_ms)
      SELECT gen_random_uuid(), ${setUuid}::uuid, il.id,
             row_number() OVER (
               ORDER BY il.t_ms ASC NULLS LAST, il.created_at ASC, il.id ASC
             ) - 1
               + COALESCE((SELECT max(f.position) + 1 FROM frame_set_frame f
                           WHERE f.set_id = ${setUuid}::uuid), 0),
             il.t_ms
      FROM image_library il
      WHERE il.session_id = ${sessionId}
        AND il.source IN ('generated', 'story') AND il.status = 'active'
      ON CONFLICT DO NOTHING`);
  }
  /* oxlint-enable no-await-in-loop */

  // 3) Reconverge the denormalized member counts (also self-heals any drift
  // from the live append path).
  await db.execute(sql`
    UPDATE frame_set fs SET frame_count = c.n
    FROM (SELECT set_id, count(*)::int AS n
          FROM frame_set_frame GROUP BY set_id) c
    WHERE c.set_id = fs.id AND fs.frame_count <> c.n`);

  logger.info({ builtins, recordings }, "frame_set boot-converge complete");
};
