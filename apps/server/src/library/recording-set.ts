import { typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";

import type { PoolLike } from "../db/pool";

// Recording-on-live: a signed-in performance auto-records into a frame_set
// (origin 'recording'). Same identity scheme as the boot converger
// (frame-set-boot-migrate.ts): set uuid = the lse_ typeid's uuid, so the
// converger, this live path, and a /s/<set_id> permalink all land on the same
// row for the same performance. Every call is plain idempotent SQL — callers
// fire-and-forget; recording must never break generation.

// Name format matches the converger's backfilled recordings ("2026-06-09 · 14:05").
const recordingName = (startedAt: Date): string =>
  startedAt.toISOString().slice(0, 16).replace("T", " · ");

// Upsert the performance's recording set. Cheap enough to run before every
// frame append; ON CONFLICT resumes status='recording' so a reconnect (or a
// performance the boot converger already finalized) keeps appending to the
// same set.
export const ensureRecordingSet = async (
  pool: PoolLike,
  opts: { liveSessionId: LiveSessionId; userUuid: string; startedAt: Date }
): Promise<void> => {
  const setUuid = typeIdToUuid(opts.liveSessionId).uuid;
  await pool.query(
    `INSERT INTO frame_set
       (id, live_session_id, name, origin, status, user_id, visibility)
     VALUES ($1::uuid, $2, $3, 'recording', 'recording', $4::uuid, 'private')
     ON CONFLICT (id) DO UPDATE SET status = 'recording'`,
    [setUuid, opts.liveSessionId, recordingName(opts.startedAt), opts.userUuid]
  );
};

// Append one persisted frame at the end of the recording. Bare ON CONFLICT DO
// NOTHING covers both unique indexes ((set_id, frame_id) and
// (set_id, position)); the frame_count cache only bumps on an actual insert.
export const appendRecordingFrame = async (
  pool: PoolLike,
  opts: { liveSessionId: LiveSessionId; frameUuid: string; tMs: number }
): Promise<void> => {
  const setUuid = typeIdToUuid(opts.liveSessionId).uuid;
  const inserted = await pool.query(
    `INSERT INTO frame_set_frame (id, set_id, frame_id, position, t_ms)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid,
             COALESCE((SELECT max(position) + 1 FROM frame_set_frame
                       WHERE set_id = $1::uuid), 0),
             $3)
     ON CONFLICT DO NOTHING`,
    [setUuid, opts.frameUuid, opts.tMs]
  );
  if ((inserted.rowCount ?? 0) > 0) {
    await pool.query(
      "UPDATE frame_set SET frame_count = frame_count + 1 WHERE id = $1::uuid",
      [setUuid]
    );
  }
};

// Close out the performance: the take is final. Status-guarded so finalizing
// an already-final (or never-created) recording is a no-op.
export const finalizeRecordingSet = async (
  pool: PoolLike,
  liveSessionId: LiveSessionId
): Promise<void> => {
  await pool.query(
    `UPDATE frame_set SET status = 'final'
     WHERE live_session_id = $1 AND status = 'recording'`,
    [liveSessionId]
  );
};
