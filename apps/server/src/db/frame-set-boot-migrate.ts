import { DECKS } from "@sonara/shared";
import { typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";

import type { Logger } from "../lib/logger";
import { getPool } from "./pool";
import type { PoolLike } from "./pool";

// Idempotent converger of the legacy two-concept world (built-in decks,
// derived sessions) into the unified frame_set tables. Runs on every server
// boot after migrations + the library seed — same rationale: prod and any
// fresh DB converge to the same state with no manual railway-run.
//
// Idempotency comes from deterministic ids + ON CONFLICT DO NOTHING:
//   builtin    one set per DeckKey, guarded by the partial unique index on
//              (deck_key) WHERE origin='builtin'.
//   recording  set uuid = the lse_ typeid's uuid, so re-deriving from the
//              same session always hits the same row — and a share permalink
//              (/s/<set_id>) is computable from a liveSessionId alone.
//
// Junction inserts use a bare ON CONFLICT DO NOTHING (covers both the
// (set_id, frame_id) and (set_id, position) unique indexes); new frames
// append past max(position), so reruns converge instead of colliding.
//
// (The curated step — legacy reels → curated sets — moved into migration
// 0006, which copies then DROPs the reel/reel_frame tables; uuid identity
// made it pure SQL, so nothing here reads them anymore.)
export const migrateFrameSetsOnBoot = async (
  logger: Logger,
  pool: PoolLike = getPool()
): Promise<void> => {
  let builtins = 0;
  let recordings = 0;

  // 1) Built-in decks → builtin sets (one per DeckKey, public, system-owned).
  for (const deck of DECKS) {
    const res = await pool.query(
      `INSERT INTO frame_set (id, deck_key, name, origin, status, user_id, visibility)
       VALUES (gen_random_uuid(), $1, $2, 'builtin', 'final', NULL, 'public')
       ON CONFLICT (deck_key) WHERE origin = 'builtin' DO NOTHING`,
      [deck.key, deck.label]
    );
    builtins += res.rowCount ?? 0;
    await pool.query(
      `INSERT INTO frame_set_frame (id, set_id, frame_id, position, t_ms)
       SELECT gen_random_uuid(), fs.id, il.id,
              row_number() OVER (ORDER BY il.id) - 1
                + COALESCE((SELECT max(f.position) + 1 FROM frame_set_frame f
                            WHERE f.set_id = fs.id), 0),
              NULL
       FROM image_library il
       CROSS JOIN (SELECT id FROM frame_set
                   WHERE origin = 'builtin' AND deck_key = $1) fs
       WHERE il.deck = $1 AND il.source = 'seed' AND il.status = 'active'
       ON CONFLICT DO NOTHING`,
      [deck.key]
    );
  }

  // 2) Legacy live-play history (derived sessions) → recording sets. The
  // typeid → uuid conversion needs app code, so this loops per session;
  // session counts are small and conflicting reruns are no-ops.
  const sessions = await pool.query<{
    first_at: Date;
    session_id: string;
    user_id: string;
  }>(
    `SELECT session_id, user_id, min(created_at) AS first_at
     FROM image_library
     WHERE source IN ('generated', 'story')
       AND session_id IS NOT NULL AND user_id IS NOT NULL
     GROUP BY session_id, user_id`
  );
  for (const row of sessions.rows) {
    const setUuid = typeIdToUuid(row.session_id as LiveSessionId).uuid;
    const name = new Date(row.first_at)
      .toISOString()
      .slice(0, 16)
      .replace("T", " · ");
    const res = await pool.query(
      `INSERT INTO frame_set
         (id, live_session_id, name, origin, status, user_id, visibility, created_at)
       VALUES ($1::uuid, $2, $3, 'recording', 'final', $4::uuid, 'private', $5)
       ON CONFLICT (id) DO NOTHING`,
      [setUuid, row.session_id, name, row.user_id, row.first_at]
    );
    recordings += res.rowCount ?? 0;
    await pool.query(
      `INSERT INTO frame_set_frame (id, set_id, frame_id, position, t_ms)
       SELECT gen_random_uuid(), $1::uuid, il.id,
              row_number() OVER (
                ORDER BY il.t_ms ASC NULLS LAST, il.created_at ASC, il.id ASC
              ) - 1
                + COALESCE((SELECT max(f.position) + 1 FROM frame_set_frame f
                            WHERE f.set_id = $1::uuid), 0),
              il.t_ms
       FROM image_library il
       WHERE il.session_id = $2
         AND il.source IN ('generated', 'story') AND il.status = 'active'
       ON CONFLICT DO NOTHING`,
      [setUuid, row.session_id]
    );
  }

  // 3) Reconverge the denormalized member counts (also self-heals any drift
  // from the live append path).
  await pool.query(
    `UPDATE frame_set fs SET frame_count = c.n
     FROM (SELECT set_id, count(*)::int AS n
           FROM frame_set_frame GROUP BY set_id) c
     WHERE c.set_id = fs.id AND fs.frame_count <> c.n`
  );

  logger.info({ builtins, recordings }, "frame_set boot-converge complete");
};
