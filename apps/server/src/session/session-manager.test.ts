import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import type { Database } from "@sonara/db";
import { createLogger } from "@sonara/logger";
import type { ServerEvent } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId, StageId, UserId } from "@sonara/shared/typeid";
import type { PoolShim } from "@sonara/test-utils";
import { createTestStage, createTestUser } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";

import { __setDbForTests } from "../db/db";
import { ensureRecordingSet } from "../library/recording-set";
import type { AttachedWs } from "./session-manager";
import { SessionManager } from "./session-manager";

// Stage-keyed attach/detach lifecycle: grace-window resume, expiry finalize,
// takeover, and verbatim legacy (`conn:`) semantics. Sessions are real (the
// generation engine is cheap to construct — the fal pool dials lazily); the
// pg pool is the harness shim so finalize lands on the real schema.

const logger = createLogger({
  env: { environment: "local", service: "test" },
  level: "silent",
  name: "test",
});

const GRACE_MS = 30;
const sleep = (ms: number): Promise<void> => Bun.sleep(ms);

const makeWs = (id: string): AttachedWs & { closed: { code?: number }[] } => {
  const closed: { code?: number }[] = [];
  return {
    close(code?: number) {
      closed.push({ code });
    },
    closed,
    data: { sessionId: id },
  };
};

let pool: PoolShim;
let db: Database;
const userId = typeIdGenerator("user") as UserId;
const userUuid = typeIdToUuid(userId).uuid;
let stageId: StageId;

const recordingStatus = async (lse: LiveSessionId): Promise<string | null> => {
  const res = await pool.query<{ status: string }>(
    "SELECT status FROM frame_set WHERE live_session_id = $1",
    [lse]
  );
  return res.rows[0]?.status ?? null;
};

beforeAll(async () => {
  const t = await getTestDb();
  ({ db, pool } = t);
  await t.reset();
  __setDbForTests(db);
  await createTestUser(t.db, { id: userId });
  ({ id: stageId } = await createTestStage(t.db, { userId }));
}, 30_000);

afterAll(() => {
  __setDbForTests(null);
});

describe("SessionManager (stage-keyed)", () => {
  test("reconnect within grace resumes the same Session and run", () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const ws1 = makeWs("conn-a");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws: ws1,
    });
    const run = session.liveSessionId;
    expect(session.isAttached()).toBe(true);

    m.detach(stageId, ws1);
    expect(session.isAttached()).toBe(false);
    expect(m.screenAttached(stageId)).toBe(false);
    // Still discoverable during grace (lens reads it as live).
    expect(m.getByStageId(stageId)).toBe(session);

    const ws2 = makeWs("conn-b");
    const again = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws: ws2,
    });
    expect(again.resumed).toBe(true);
    expect(again.session).toBe(session);
    expect(again.session.liveSessionId).toBe(run);
    expect(session.isAttached()).toBe(true);
    m.endRun(stageId);
  });

  test("grace expiry finalizes the recording set and evicts the run", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const ws = makeWs("conn-c");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws,
    });
    const run = session.liveSessionId;
    await ensureRecordingSet(db, {
      liveSessionId: run,
      stageId,
      startedAt: new Date(),
      userId,
    });
    expect(await recordingStatus(run)).toBe("recording");

    m.detach(stageId, ws);
    await sleep(GRACE_MS * 4);
    expect(m.getByStageId(stageId)).toBeUndefined();
    expect(await recordingStatus(run)).toBe("final");

    // The stage stamp landed on the set row.
    const res = await pool.query<{ stage_id: string | null }>(
      "SELECT stage_id FROM frame_set WHERE live_session_id = $1",
      [run]
    );
    expect(res.rows[0]?.stage_id).toBe(typeIdToUuid(stageId).uuid);
  });

  test("takeover: event to both, old socket kicked 4409, late detach no-ops", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const ws1 = makeWs("old-screen");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws: ws1,
    });

    const events: ServerEvent[] = [];
    const ac = new AbortController();
    const consumer = (async () => {
      for await (const ev of session.subscribe(ac.signal)) {
        events.push(ev);
        if (ev.type === "screen.takenOver") {
          break;
        }
      }
    })();

    const ws2 = makeWs("new-screen");
    const took = m.attach({ key: stageId, stageId, userId: userUuid, ws: ws2 });
    expect(took.session).toBe(session);
    await consumer;
    ac.abort();

    const kicked = events.find((e) => e.type === "screen.takenOver");
    expect(kicked).toMatchObject({ connectionId: "old-screen" });
    expect(ws1.closed).toEqual([{ code: 4409 }]);

    // The kicked socket's close callback arrives late — must not detach ws2.
    m.detach(stageId, ws1);
    expect(m.screenAttached(stageId)).toBe(true);
    expect(session.isAttached()).toBe(true);
    m.endRun(stageId);
  });

  test("same-tab reconnect over a half-dead socket is a RESUME, never a takeover", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    // Same connectionId on both sockets — the per-tab id is reused for every
    // reconnect attempt, so this models wake-from-sleep / proxy cut where the
    // server still holds the stale socket.
    const stale = makeWs("same-tab");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws: stale,
    });

    const events: ServerEvent[] = [];
    const ac = new AbortController();
    const consumer = (async () => {
      for await (const ev of session.subscribe(ac.signal)) {
        events.push(ev);
      }
    })();

    const fresh = makeWs("same-tab");
    const again = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws: fresh,
    });
    expect(again.resumed).toBe(true);
    expect(again.session).toBe(session);
    // The stale socket is closed NORMALLY (not 4409 — the client must not
    // treat its own reconnect as a kick)…
    expect(stale.closed).toEqual([{ code: 1000 }]);
    // …and NO screen.takenOver event reaches the shared publisher.
    await sleep(30);
    ac.abort();
    await consumer.catch(() => {
      // aborting the iterator is the expected exit
    });
    expect(events.some((e) => e.type === "screen.takenOver")).toBe(false);

    // The stale socket's late close callback must not detach the fresh one.
    m.detach(stageId, stale);
    expect(m.screenAttached(stageId)).toBe(true);
    m.endRun(stageId);
  });

  test("legacy conn: key finalizes immediately on detach (no grace)", async () => {
    const m = new SessionManager(logger, { graceMs: 60_000 });
    const ws = makeWs("legacy-1");
    const legacyLse = typeIdGenerator("liveSession") as LiveSessionId;
    const { session } = m.attach({
      key: "conn:legacy-1",
      liveSessionId: legacyLse,
      stageId: null,
      userId: userUuid,
      ws,
    });
    expect(session.liveSessionId).toBe(legacyLse);
    await ensureRecordingSet(db, {
      liveSessionId: legacyLse,
      startedAt: new Date(),
      userId,
    });

    m.detach("conn:legacy-1", ws);
    expect(m.getByKey("conn:legacy-1")).toBeUndefined();
    // No 60s wait — finalize fired on detach. Give the fire-and-forget a tick.
    await sleep(50);
    expect(await recordingStatus(legacyLse)).toBe("final");
  });

  test("anon: keyed by anonStageId, resumes, never persists", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const key = "anon:abcdefgh1234";
    const ws1 = makeWs("anon-1");
    const { session } = m.attach({ key, stageId: null, userId: null, ws: ws1 });
    const run = session.liveSessionId;

    m.detach(key, ws1);
    const ws2 = makeWs("anon-2");
    const again = m.attach({ key, stageId: null, userId: null, ws: ws2 });
    expect(again.resumed).toBe(true);
    expect(again.session.liveSessionId).toBe(run);

    m.endRun(key);
    await sleep(30);
    // Anon runs never create frame_set rows (and endRun skips finalize).
    expect(await recordingStatus(run)).toBeNull();
  });

  test("startNewRun finalizes the old segment and re-keys in place", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const ws = makeWs("conn-d");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws,
    });
    const first = session.liveSessionId;
    await ensureRecordingSet(db, {
      liveSessionId: first,
      startedAt: new Date(),
      userId,
    });

    const events: ServerEvent[] = [];
    const ac = new AbortController();
    const consumer = (async () => {
      for await (const ev of session.subscribe(ac.signal)) {
        events.push(ev);
        if (ev.type === "run.started") {
          break;
        }
      }
    })();
    const second = session.startNewRun();
    await consumer;
    ac.abort();

    expect(second).not.toBe(first);
    expect(session.liveSessionId).toBe(second);
    expect(m.getByLiveSessionId(second)).toBe(session);
    expect(m.getByLiveSessionId(first)).toBeUndefined();
    expect(events.at(-1)).toMatchObject({
      liveSessionId: second,
      type: "run.started",
    });
    await sleep(50);
    expect(await recordingStatus(first)).toBe("final");
    m.endRun(stageId);
  });

  test("closeAll drains the registry and finalizes recordings (deploy shutdown)", async () => {
    const m = new SessionManager(logger, { graceMs: GRACE_MS });
    const ws = makeWs("conn-e");
    const { session } = m.attach({
      key: stageId,
      stageId,
      userId: userUuid,
      ws,
    });
    const run = session.liveSessionId;
    await ensureRecordingSet(db, {
      liveSessionId: run,
      stageId,
      startedAt: new Date(),
      userId,
    });
    expect(await recordingStatus(run)).toBe("recording");

    await m.closeAll();

    expect(m.count()).toBe(0);
    expect(m.getByStageId(stageId)).toBeUndefined();
    expect(await recordingStatus(run)).toBe("final");
  });
});
