import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { typeIdFromUuid, typeIdToUuid } from "@sonara/shared/typeid";
import type {
  FrameSetId,
  ImageLibraryId,
  LiveSessionId,
  StageId,
  UserId,
} from "@sonara/shared/typeid";
import { and, eq, inArray, sql } from "drizzle-orm";

// Recording-on-live: a signed-in performance auto-records into a frame_set
// (origin 'recording'). Same identity scheme as the boot converger
// (frame-set-boot-migrate.ts): set uuid = the lse_ typeid's uuid, so the
// converger, this live path, and a /s/<set_id> permalink all land on the same
// row for the same performance. drizzle over the shared db handle — callers
// fire-and-forget; recording must never break generation.

// Name format matches the converger's backfilled recordings ("2026-06-09 · 14:05").
const recordingName = (startedAt: Date): string =>
  startedAt.toISOString().slice(0, 16).replace("T", " · ");

// The recording set's id: a frameSet typeid whose uuid IS the live session's
// uuid, so /s/<set_id> is derivable from the lse id without a round trip.
const recordingSetId = (liveSessionId: LiveSessionId): FrameSetId =>
  typeIdFromUuid("frameSet", typeIdToUuid(liveSessionId).uuid);

// Upsert the performance's recording set. Cheap enough to run before every
// frame append; ON CONFLICT resumes status='recording' so a reconnect (or a
// performance the boot converger already finalized) keeps appending to the
// same set.
//
// Live recordings are born 'unlisted', not 'private': the /s/<set_id> link
// shared DURING the show must keep working as a replay after it ends — the
// link is the capability. (Converger-backfilled legacy sessions stay private;
// nobody ever held their links.) The owner can flip to private to kill a link.
export const ensureRecordingSet = async (
  db: Database,
  opts: {
    liveSessionId: LiveSessionId;
    userId: UserId;
    startedAt: Date;
    // The stage this run plays on; null for legacy/anon runs. COALESCE keeps
    // an existing stamp — a resume can only fill, never move a recording to a
    // different stage.
    stageId?: StageId | null;
  }
): Promise<void> => {
  await db
    .insert(SCHEMA.frameSet)
    .values({
      id: recordingSetId(opts.liveSessionId),
      liveSessionId: opts.liveSessionId,
      name: recordingName(opts.startedAt),
      origin: "recording",
      stageId: opts.stageId ?? null,
      status: "recording",
      userId: opts.userId,
      visibility: "unlisted",
    })
    .onConflictDoUpdate({
      set: {
        stageId: sql`COALESCE(${SCHEMA.frameSet.stageId}, excluded.stage_id)`,
        status: "recording",
      },
      target: SCHEMA.frameSet.id,
    });
};

// Append one persisted frame at the end of the recording. Bare ON CONFLICT DO
// NOTHING covers both unique indexes ((set_id, frame_id) and
// (set_id, position)); the frame_count cache only bumps on an actual insert.
export const appendRecordingFrame = async (
  db: Database,
  opts: { liveSessionId: LiveSessionId; frameId: ImageLibraryId; tMs: number }
): Promise<void> => {
  const setId = recordingSetId(opts.liveSessionId);
  // The position subquery lives in a raw sql fragment, which binds values
  // verbatim (no typeId translation) — so it addresses set_id by the raw uuid.
  const setUuid = typeIdToUuid(opts.liveSessionId).uuid;
  const inserted = await db
    .insert(SCHEMA.frameSetFrame)
    .values({
      frameId: opts.frameId,
      position: sql`COALESCE((SELECT max(${SCHEMA.frameSetFrame.position}) + 1 FROM ${SCHEMA.frameSetFrame} WHERE ${SCHEMA.frameSetFrame.setId} = ${setUuid}::uuid), 0)`,
      setId,
      tMs: opts.tMs,
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length > 0) {
    await db
      .update(SCHEMA.frameSet)
      .set({ frameCount: sql`${SCHEMA.frameSet.frameCount} + 1` })
      .where(eq(SCHEMA.frameSet.id, setId));
  }
};

// Close out the performance: the take is final. Status-guarded so finalizing
// an already-final (or never-created) recording is a no-op.
export const finalizeRecordingSet = async (
  db: Database,
  liveSessionId: LiveSessionId
): Promise<void> => {
  await db
    .update(SCHEMA.frameSet)
    .set({ status: "final" })
    .where(
      and(
        eq(SCHEMA.frameSet.liveSessionId, liveSessionId),
        eq(SCHEMA.frameSet.status, "recording")
      )
    );
};

// Boot sweep: the session registry is in-memory, so any row still 'recording'
// at process start belongs to a run that died with the previous process
// (crash, or a deploy racing the shutdown drain) — no live owner can exist.
// Finalizing all of them is safe: runs never resume across restarts (a
// reconnecting screen mints a fresh lse id), and the one resumable case —
// legacy clients re-sending their sessionStorage lse — re-opens the set via
// ensureRecordingSet's ON CONFLICT anyway. Returns the swept count.
//
// Also sweeps 'generating' sets that have NO live generation_job — orphans
// from before the durable-worker era (or a job row that was deleted). A
// 'generating' set that still has a pending/running job is left alone: the
// worker resumes it from its cursor (resetOrphanedJobs flips dead 'running'
// jobs back to 'pending' at boot). Recording sets never have a job, so the
// NOT EXISTS is always true for them — their behaviour is unchanged.
export const finalizeStaleRecordingSets = async (
  db: Database
): Promise<number> => {
  const rows = await db
    .update(SCHEMA.frameSet)
    .set({ status: "final" })
    .where(
      and(
        inArray(SCHEMA.frameSet.status, ["recording", "generating"]),
        sql`NOT EXISTS (SELECT 1 FROM ${SCHEMA.generationJob} j WHERE j.set_id = ${SCHEMA.frameSet.id} AND j.status IN ('pending', 'running'))`
      )
    )
    .returning();
  return rows.length;
};
