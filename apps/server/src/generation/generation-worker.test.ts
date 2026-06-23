import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { SCHEMA } from "@sonara/db";
import type { SetLook } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { FrameSetId, UserId } from "@sonara/shared/typeid";
import { createTestUser, insertFrame } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";
import { eq, sql } from "drizzle-orm";

import { __setDbForTests } from "../db/db";
import type {
  PersistFrameInput,
  PersistedFrame,
} from "../library/persist-frame";
import { finalizeStaleRecordingSets } from "../library/recording-set";
import type { RunJobDeps } from "./generation-worker";
import {
  claimJob,
  enqueueGenerationJob,
  hasActiveJobForUser,
  resetOrphanedJobs,
  runJob,
} from "./generation-worker";

// Exercises the durable worker's DB lifecycle on real migrations (PGlite),
// stubbing the two side-effecting steps (fal render + bucket persist) so we can
// assert claim/resume/cancel/out-of-credits/finalize without network.

const USER_ID = typeIdGenerator("user") as UserId;
const LOOK: SetLook = {
  cadence: { calm: 3000, loud: 1000 },
  intensity: 0.4,
  preset: "wet_ink",
};

let t: TestDb;

const stubRender: RunJobDeps["render"] = () =>
  Promise.resolve("https://fal.example/fake.jpg");

// The persist stub inserts a REAL image_library row (so the frame_set_frame FK
// holds) using the worker's pre-minted id, then returns a PersistedFrame.
const stubPersist: RunJobDeps["persist"] = async (
  input: PersistFrameInput
): Promise<PersistedFrame> => {
  await t.db.insert(SCHEMA.imageLibrary).values({
    deck: input.deck,
    height: input.height,
    id: input.id,
    model: input.model,
    prompt: input.prompt,
    promptHash: `gen:${input.sessionId}:${input.tMs}`,
    seed: input.seed,
    sessionId: input.sessionId,
    source: "generated",
    status: "active",
    url: `k/${input.id}`,
    userId: input.userId,
    width: input.width,
  });
  return {
    createdAt: new Date(),
    deck: input.deck,
    height: input.height,
    id: input.id,
    palette: null,
    prompt: input.prompt,
    sessionId: input.sessionId,
    tMs: input.tMs,
    url: `u/${input.id}`,
    width: input.width,
  };
};

const deps: RunJobDeps = { persist: stubPersist, render: stubRender };

beforeAll(async () => {
  t = await getTestDb();
  __setDbForTests(t.db);
}, 30_000);

afterAll(() => {
  __setDbForTests(null);
});

beforeEach(async () => {
  await t.reset();
  await createTestUser(t.db, { id: USER_ID });
});

// --- helpers ---------------------------------------------------------------

const seedCredits = async (frames: number): Promise<void> => {
  await t.db
    .insert(SCHEMA.credits)
    .values({ balanceFrames: frames, userId: USER_ID });
};

// Push the hourly free-tier counter past its limit so a 0-balance debit can't
// silently fall through to free generations.
const drainFreeTier = async (): Promise<void> => {
  await t.db.insert(SCHEMA.freeTierLedger).values({
    usageCount: 99,
    userId: USER_ID,
    windowStart: sql`date_trunc('hour', now())`,
  });
};

const makeSet = async (): Promise<FrameSetId> => {
  const [row] = await t.db
    .insert(SCHEMA.frameSet)
    .values({
      name: "gen",
      origin: "curated",
      status: "generating",
      userId: USER_ID,
    })
    .returning();
  if (!row) {
    throw new Error("failed to create test set");
  }
  return row.id;
};

const enqueue = (
  setId: FrameSetId,
  prompts: string[],
  total: number
): Promise<void> =>
  enqueueGenerationJob({
    db: t.db,
    description: null,
    kind: "create",
    look: LOOK,
    prompts,
    setId,
    styleAnchor: "a locked jade-and-gold world",
    total,
    userId: USER_ID,
  });

const claimOrThrow = async () => {
  const job = await claimJob(t.db);
  if (!job) {
    throw new Error("expected a claimable job");
  }
  return job;
};

const members = (setId: FrameSetId) =>
  t.db
    .select({ position: SCHEMA.frameSetFrame.position })
    .from(SCHEMA.frameSetFrame)
    .where(eq(SCHEMA.frameSetFrame.setId, setId))
    .orderBy(SCHEMA.frameSetFrame.position);

const jobStatus = async (setId: FrameSetId): Promise<string | undefined> => {
  const [j] = await t.db
    .select({ status: SCHEMA.generationJob.status })
    .from(SCHEMA.generationJob)
    .where(eq(SCHEMA.generationJob.setId, setId))
    .limit(1);
  return j?.status;
};

const setRow = async (setId: FrameSetId) => {
  const [s] = await t.db
    .select({
      frameCount: SCHEMA.frameSet.frameCount,
      status: SCHEMA.frameSet.status,
    })
    .from(SCHEMA.frameSet)
    .where(eq(SCHEMA.frameSet.id, setId))
    .limit(1);
  return s;
};

const balance = async (): Promise<number> => {
  const [c] = await t.db
    .select({ b: SCHEMA.credits.balanceFrames })
    .from(SCHEMA.credits)
    .where(eq(SCHEMA.credits.userId, USER_ID))
    .limit(1);
  return c?.b ?? 0;
};

// --- tests -----------------------------------------------------------------

describe("generation worker", () => {
  test("claim → run renders all frames, finalizes the set, debits credits", async () => {
    await seedCredits(10);
    const setId = await makeSet();
    await enqueue(setId, ["a", "b", "c"], 3);

    const job = await claimOrThrow();
    expect(job.status).toBe("running");
    // Only one job exists and it's now running with a fresh lease.
    expect(await claimJob(t.db)).toBeNull();

    await runJob(t.db, job, deps);

    const mem = await members(setId);
    expect(mem.map((m) => m.position)).toEqual([0, 1, 2]);
    const s = await setRow(setId);
    expect(s?.frameCount).toBe(3);
    expect(s?.status).toBe("final");
    expect(await jobStatus(setId)).toBe("done");
    expect(await balance()).toBe(7);
  });

  test("resumes from a persisted cursor without duplicating frames", async () => {
    await seedCredits(10);
    const setId = await makeSet();
    // Simulate a prior partial run: 2 members already present, frameCount=2.
    const f0 = await insertFrame(t.db, {
      source: "generated",
      userId: USER_ID,
    });
    const f1 = await insertFrame(t.db, {
      source: "generated",
      userId: USER_ID,
    });
    await t.db.insert(SCHEMA.frameSetFrame).values([
      { frameId: f0, position: 0, setId },
      { frameId: f1, position: 1, setId },
    ]);
    await t.db
      .update(SCHEMA.frameSet)
      .set({ frameCount: 2 })
      .where(eq(SCHEMA.frameSet.id, setId));
    await enqueue(setId, ["a", "b", "c", "d", "e"], 5);
    // The job resumes from cursor=2 (frames 0,1 already done).
    await t.db
      .update(SCHEMA.generationJob)
      .set({ cursor: 2 })
      .where(eq(SCHEMA.generationJob.setId, setId));

    const job = await claimOrThrow();
    await runJob(t.db, job, deps);

    const mem = await members(setId);
    expect(mem.map((m) => m.position)).toEqual([0, 1, 2, 3, 4]);
    const s = await setRow(setId);
    expect(s?.frameCount).toBe(5);
    // Only the 3 resumed frames were billed.
    expect(await balance()).toBe(7);
  });

  test("cancel mid-job stops and finalizes the partial set", async () => {
    await seedCredits(10);
    const setId = await makeSet();
    await enqueue(setId, ["a", "b", "c", "d", "e"], 5);
    const job = await claimOrThrow();

    let calls = 0;
    const cancelOnSecond: RunJobDeps["render"] = async () => {
      calls += 1;
      if (calls === 2) {
        await t.db
          .update(SCHEMA.generationJob)
          .set({ status: "canceled" })
          .where(eq(SCHEMA.generationJob.id, job.id));
      }
      return "https://fal.example/fake.jpg";
    };
    await runJob(t.db, job, { persist: stubPersist, render: cancelOnSecond });

    // Frames 0 and 1 landed; the cancel is seen at the top of iteration 2.
    const mem = await members(setId);
    expect(mem.length).toBe(2);
    expect(await jobStatus(setId)).toBe("canceled");
    const s = await setRow(setId);
    expect(s?.status).toBe("final");
  });

  test("out-of-credits stops with a partial, finalized set", async () => {
    await seedCredits(2);
    await drainFreeTier();
    const setId = await makeSet();
    await enqueue(setId, ["a", "b", "c", "d", "e"], 5);

    await runJob(t.db, await claimOrThrow(), deps);

    const mem = await members(setId);
    expect(mem.length).toBe(2);
    const s = await setRow(setId);
    expect(s?.status).toBe("final");
    expect(await jobStatus(setId)).toBe("done");
    expect(await balance()).toBe(0);
  });

  test("resetOrphanedJobs flips running back to pending so it re-claims", async () => {
    const setId = await makeSet();
    await enqueue(setId, ["a"], 1);
    const job = await claimOrThrow();
    expect(job.status).toBe("running");
    expect(await claimJob(t.db)).toBeNull();

    expect(await resetOrphanedJobs(t.db)).toBe(1);

    const reclaimed = await claimOrThrow();
    expect(reclaimed.id).toBe(job.id);
  });

  test("hasActiveJobForUser tracks pending/running vs done", async () => {
    await seedCredits(10);
    const setId = await makeSet();
    await enqueue(setId, ["a"], 1);
    expect(await hasActiveJobForUser(t.db, USER_ID)).toBe(true);

    await runJob(t.db, await claimOrThrow(), deps);
    expect(await hasActiveJobForUser(t.db, USER_ID)).toBe(false);
  });

  test("boot sweep finalizes job-less generating sets, spares ones with a live job", async () => {
    // pending job → must NOT be swept
    const withJob = await makeSet();
    await enqueue(withJob, ["a"], 1);
    // generating, no job → swept
    const orphan = await makeSet();

    const swept = await finalizeStaleRecordingSets(t.db);
    expect(swept).toBeGreaterThanOrEqual(1);
    const orphanRow = await setRow(orphan);
    expect(orphanRow?.status).toBe("final");
    const withJobRow = await setRow(withJob);
    expect(withJobRow?.status).toBe("generating");
  });
});
