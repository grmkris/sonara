import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import type { SetLook } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { FrameSetId, UserId } from "@sonara/shared/typeid";
import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";

import {
  COST_PER_FRAME,
  refundOnError,
  tryDebitCredit,
} from "../credits/credit-gate";
import { getDb } from "../db/db";
import { env } from "../env";
import { logger as rootLogger } from "../lib/logger";
import { persistFrame } from "../library/persist-frame";
import {
  FRAME_SIZE,
  NOMINAL_FRAME_MS,
  renderFrame,
  seedFrom,
} from "./frame-pipeline";

// Durable, resumable generation worker. Postgres is the queue: each
// `generation_job` row carries the prompt list + a `cursor` persisted every
// frame, so a deploy/crash mid-job RESUMES from the cursor instead of
// stranding frames. A small pool of in-process threads claims jobs atomically
// (FOR UPDATE SKIP LOCKED + a lease) and runs each one sequentially. No
// external queue/service — just this process polling its own table.

type JobRow = typeof SCHEMA.generationJob.$inferSelect;

const CONCURRENCY = 3;
const POLL_MS = 1500;
// A claimed job that doesn't renew its lease within this window is considered
// dead (the process died) and becomes re-claimable.
const LEASE_SQL = sql`now() + interval '90 seconds'`;

let started = false;

const ACTIVE = ["pending", "running"] as const;

// --- claim / lifecycle -----------------------------------------------------

// Atomically claim the oldest claimable job: pending, or running with an
// expired lease (a dead worker). The inner SELECT … FOR UPDATE SKIP LOCKED
// makes concurrent threads (and, defensively, multiple instances) never grab
// the same row. Exported for the worker test.
export const claimJob = async (db: Database): Promise<JobRow | null> => {
  const claimable = db
    .select({ id: SCHEMA.generationJob.id })
    .from(SCHEMA.generationJob)
    .where(
      or(
        eq(SCHEMA.generationJob.status, "pending"),
        and(
          eq(SCHEMA.generationJob.status, "running"),
          or(
            isNull(SCHEMA.generationJob.leaseExpiresAt),
            lt(SCHEMA.generationJob.leaseExpiresAt, sql`now()`)
          )
        )
      )
    )
    .orderBy(SCHEMA.generationJob.createdAt)
    .limit(1)
    .for("update", { skipLocked: true });

  const [job] = await db
    .update(SCHEMA.generationJob)
    .set({
      leaseExpiresAt: LEASE_SQL,
      status: "running",
      updatedAt: new Date(),
    })
    .where(inArray(SCHEMA.generationJob.id, claimable))
    .returning();
  return job ?? null;
};

// Persist the cursor + renew the lease after each frame (success or skip).
const advance = async (
  db: Database,
  jobId: JobRow["id"],
  cursor: number
): Promise<number> => {
  const next = cursor + 1;
  await db
    .update(SCHEMA.generationJob)
    .set({ cursor: next, leaseExpiresAt: LEASE_SQL, updatedAt: new Date() })
    .where(eq(SCHEMA.generationJob.id, jobId));
  return next;
};

// Flip the set to 'final' once no job still targets it (the last job of a
// multi-job set finalizes it).
const finalizeSetIfIdle = async (
  db: Database,
  setId: FrameSetId
): Promise<void> => {
  const active = await db
    .select({ id: SCHEMA.generationJob.id })
    .from(SCHEMA.generationJob)
    .where(
      and(
        eq(SCHEMA.generationJob.setId, setId),
        inArray(SCHEMA.generationJob.status, [...ACTIVE])
      )
    )
    .limit(1);
  if (active.length === 0) {
    await db
      .update(SCHEMA.frameSet)
      .set({ status: "final" })
      .where(eq(SCHEMA.frameSet.id, setId));
  }
};

const finishJob = async (db: Database, job: JobRow): Promise<void> => {
  // Mark done only if still running — a cancel may have set 'canceled', which
  // we must preserve.
  await db
    .update(SCHEMA.generationJob)
    .set({ leaseExpiresAt: null, status: "done", updatedAt: new Date() })
    .where(
      and(
        eq(SCHEMA.generationJob.id, job.id),
        eq(SCHEMA.generationJob.status, "running")
      )
    );
  await finalizeSetIfIdle(db, job.setId);
};

const failJob = async (
  db: Database,
  job: JobRow,
  error: string
): Promise<void> => {
  await db
    .update(SCHEMA.generationJob)
    .set({
      error: error.slice(0, 500),
      leaseExpiresAt: null,
      status: "failed",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(SCHEMA.generationJob.id, job.id),
        eq(SCHEMA.generationJob.status, "running")
      )
    );
  await finalizeSetIfIdle(db, job.setId);
};

// --- the per-job render loop ----------------------------------------------

// The two side-effecting steps are injectable so the worker test can stub fal
// + the bucket while exercising the real DB lifecycle (claim/resume/cancel/
// finalize). Production uses the real t2i render + bucket persist.
export interface RunJobDeps {
  render: typeof renderFrame;
  persist: typeof persistFrame;
}
const DEFAULT_DEPS: RunJobDeps = { persist: persistFrame, render: renderFrame };

// Render a claimed job to completion (or until out-of-credits / canceled),
// resuming from its persisted cursor.
export const runJob = async (
  db: Database,
  job: JobRow,
  deps: RunJobDeps = DEFAULT_DEPS
): Promise<void> => {
  const logger = rootLogger.child({
    component: "gen-worker",
    jobId: job.id,
    setId: job.setId,
  });
  // Synthetic session id groups this job's image_library rows (they require
  // one; a generated set has no live session).
  const jobSessionId = typeIdGenerator("liveSession");
  const setUuid = typeIdToUuid(job.setId).uuid;
  const controller = new AbortController();
  const { prompts } = job;
  let { cursor } = job;

  logger.info(
    { from: cursor, kind: job.kind, total: job.total },
    "gen-worker: job start"
  );

  /* oxlint-disable no-await-in-loop -- sequential per-frame pipeline */
  while (cursor < prompts.length) {
    // Cancellation check (also our natural lease-renewal cadence).
    const [fresh] = await db
      .select({ status: SCHEMA.generationJob.status })
      .from(SCHEMA.generationJob)
      .where(eq(SCHEMA.generationJob.id, job.id))
      .limit(1);
    if (!fresh || fresh.status === "canceled") {
      logger.info({ cursor }, "gen-worker: canceled/gone — stopping");
      break;
    }

    const prompt = prompts[cursor] as string;
    const gate = await tryDebitCredit({
      cost: COST_PER_FRAME,
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      logger,
      now: Date.now(),
      userId: job.userId,
    });
    if (!gate.ok) {
      logger.info({ reason: gate.reason }, "gen-worker: stopping (credits)");
      break;
    }

    const seed = seedFrom(prompt, cursor);
    let url: string;
    try {
      url = await deps.render({
        logger,
        prompt,
        seed,
        signal: controller.signal,
      });
    } catch (error) {
      logger.warn({ cursor, error }, "gen-worker: render failed; skipping");
      refundOnError(job.userId, gate.paidCost, logger);
      cursor = await advance(db, job.id, cursor);
      continue;
    }

    const frameId = typeIdGenerator("imageLibrary");
    const persisted = await deps.persist({
      deck: "generated",
      falUrl: url,
      height: FRAME_SIZE,
      id: frameId,
      logger,
      model: env.FAL_TEXT_MODEL,
      palette: null,
      prompt,
      seed,
      sessionId: jobSessionId,
      tMs: cursor * NOMINAL_FRAME_MS,
      triggerReason: "generated",
      userId: job.userId,
      width: FRAME_SIZE,
    });
    if (!persisted) {
      refundOnError(job.userId, gate.paidCost, logger);
      cursor = await advance(db, job.id, cursor);
      continue;
    }

    try {
      // Append at the end of the set (create/extend); the position subquery is
      // a raw fragment, so it addresses set_id by the raw uuid.
      await db.insert(SCHEMA.frameSetFrame).values({
        frameId,
        position: sql`COALESCE((SELECT max(${SCHEMA.frameSetFrame.position}) + 1 FROM ${SCHEMA.frameSetFrame} WHERE ${SCHEMA.frameSetFrame.setId} = ${setUuid}::uuid), 0)`,
        setId: job.setId,
      });
      await db
        .update(SCHEMA.frameSet)
        .set({ frameCount: sql`${SCHEMA.frameSet.frameCount} + 1` })
        .where(eq(SCHEMA.frameSet.id, job.setId));
    } catch (error) {
      logger.warn({ cursor, error }, "gen-worker: membership insert failed");
      refundOnError(job.userId, gate.paidCost, logger);
    }
    cursor = await advance(db, job.id, cursor);
  }
  /* oxlint-enable no-await-in-loop */

  await finishJob(db, job);
  logger.info({ cursor }, "gen-worker: job complete");
};

// --- enqueue + guards (used by the RPC + boot) -----------------------------

export interface EnqueueJobInput {
  db: Database;
  userId: UserId;
  setId: FrameSetId;
  kind: "create" | "extend";
  description: string | null;
  styleAnchor: string;
  look: SetLook;
  prompts: string[];
  total: number;
}

// Insert a pending job. The worker poll picks it up within POLL_MS.
export const enqueueGenerationJob = async (
  input: EnqueueJobInput
): Promise<void> => {
  await input.db.insert(SCHEMA.generationJob).values({
    cursor: 0,
    description: input.description,
    kind: input.kind,
    look: input.look,
    prompts: input.prompts,
    setId: input.setId,
    status: "pending",
    styleAnchor: input.styleAnchor,
    total: input.total,
    userId: input.userId,
  });
};

// One-active-generation-per-user guard (replaces the old in-memory Set).
export const hasActiveJobForUser = async (
  db: Database,
  userId: UserId
): Promise<boolean> => {
  const rows = await db
    .select({ id: SCHEMA.generationJob.id })
    .from(SCHEMA.generationJob)
    .where(
      and(
        eq(SCHEMA.generationJob.userId, userId),
        inArray(SCHEMA.generationJob.status, [...ACTIVE])
      )
    )
    .limit(1);
  return rows.length > 0;
};

// Boot: a fresh process can have no legitimately-running job, so any 'running'
// row is an orphan from the dead process — reset it to 'pending' so the worker
// resumes it from its cursor immediately (no waiting for the lease to expire).
export const resetOrphanedJobs = async (db: Database): Promise<number> => {
  const rows = await db
    .update(SCHEMA.generationJob)
    .set({ leaseExpiresAt: null, status: "pending", updatedAt: new Date() })
    .where(eq(SCHEMA.generationJob.status, "running"))
    .returning();
  return rows.length;
};

// --- the worker pool -------------------------------------------------------

const workerThread = async (): Promise<void> => {
  const db = getDb();
  /* oxlint-disable no-await-in-loop -- a polling worker thread is sequential */
  // oxlint-disable-next-line no-unmodified-loop-condition -- `started` is a module-level daemon flag toggled by startGenerationWorker, not inside the loop
  while (started) {
    let job: JobRow | null = null;
    try {
      job = await claimJob(db);
    } catch (error) {
      rootLogger.error({ error }, "gen-worker: claim failed");
    }
    if (!job) {
      await Bun.sleep(POLL_MS);
      continue;
    }
    try {
      await runJob(db, job);
    } catch (error) {
      rootLogger.error({ error, jobId: job.id }, "gen-worker: job threw");
      await failJob(db, job, String(error));
    }
  }
  /* oxlint-enable no-await-in-loop */
};

export const startGenerationWorker = (): void => {
  if (started) {
    return;
  }
  started = true;
  rootLogger.info({ concurrency: CONCURRENCY }, "gen-worker: started");
  for (let i = 0; i < CONCURRENCY; i += 1) {
    void workerThread();
  }
};
