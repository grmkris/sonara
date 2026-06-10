import { beforeAll, describe, expect, test } from "bun:test";

import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";
import type { PoolShim } from "@sonara/test-utils";
import { createTestUser, insertFrame } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";

import {
  appendRecordingFrame,
  ensureRecordingSet,
  finalizeRecordingSet,
} from "./recording-set";

// Real schema via the shared harness. Tests in this file are cumulative
// (ensure → append → finalize → re-ensure), so reset() runs once in
// beforeAll, not per test.
let pool: PoolShim;

const userId = typeIdGenerator("user") as UserId;
const userUuid = typeIdToUuid(userId).uuid;
const liveSessionId = typeIdGenerator("liveSession") as LiveSessionId;
const setUuid = typeIdToUuid(liveSessionId).uuid;
const startedAt = new Date("2026-06-09T14:05:30Z");
const frameUuids: string[] = [];

beforeAll(async () => {
  const t = await getTestDb();
  ({ pool } = t);
  await t.reset();

  await createTestUser(t.db, { id: userId });
  for (let i = 0; i < 2; i += 1) {
    const frameId = await insertFrame(t.db, {
      deck: "live",
      sessionId: liveSessionId,
      url: "/library/x.webp",
      userId,
    });
    frameUuids.push(typeIdToUuid(frameId).uuid);
  }
}, 30_000);

describe("recording-set", () => {
  test("ensure → append ×2 → finalize records the performance", async () => {
    await ensureRecordingSet(pool, { liveSessionId, startedAt, userUuid });

    const created = await pool.query<{
      id: string;
      live_session_id: string;
      name: string;
      origin: string;
      status: string;
      visibility: string;
    }>("SELECT id, live_session_id, name, origin, status, visibility FROM frame_set");
    expect(created.rows.length).toBe(1);
    // Set id derives from the lse_ uuid — the SAME scheme as the boot
    // converger, so live recording and backfill converge on one row.
    expect(created.rows[0]?.id).toBe(setUuid);
    expect(created.rows[0]?.live_session_id).toBe(liveSessionId);
    expect(created.rows[0]?.name).toBe("2026-06-09 · 14:05");
    expect(created.rows[0]?.origin).toBe("recording");
    expect(created.rows[0]?.status).toBe("recording");
    // Born unlisted: the /s link shared during the show must survive it.
    expect(created.rows[0]?.visibility).toBe("unlisted");

    await appendRecordingFrame(pool, {
      frameUuid: frameUuids[0] as string,
      liveSessionId,
      tMs: 0,
    });
    await appendRecordingFrame(pool, {
      frameUuid: frameUuids[1] as string,
      liveSessionId,
      tMs: 2500,
    });

    const members = await pool.query<{
      frame_id: string;
      position: number;
      t_ms: number;
    }>(
      `SELECT frame_id, position, t_ms FROM frame_set_frame
       WHERE set_id = $1::uuid ORDER BY position ASC`,
      [setUuid]
    );
    expect(members.rows.map((m) => m.position)).toEqual([0, 1]);
    expect(members.rows.map((m) => m.t_ms)).toEqual([0, 2500]);
    expect(members.rows[0]?.frame_id).toBe(frameUuids[0] as string);

    await finalizeRecordingSet(pool, liveSessionId);
    const finalized = await pool.query<{ status: string }>(
      "SELECT status FROM frame_set WHERE id = $1::uuid",
      [setUuid]
    );
    expect(finalized.rows[0]?.status).toBe("final");
  });

  test("re-ensure resumes the same set (reconnect), keeping its name", async () => {
    // Reconnect mints a new Session with a fresh sessionStartAt — the name
    // must NOT be rewritten, only the status resumed.
    await ensureRecordingSet(pool, {
      liveSessionId,
      startedAt: new Date("2026-06-09T18:00:00Z"),
      userUuid,
    });
    const rows = await pool.query<{ name: string; status: string }>(
      "SELECT name, status FROM frame_set WHERE id = $1::uuid",
      [setUuid]
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]?.status).toBe("recording");
    expect(rows.rows[0]?.name).toBe("2026-06-09 · 14:05");
  });

  test("append is conflict-safe and frame_count stays correct", async () => {
    // Re-appending a member frame is a no-op and must not bump the count.
    await appendRecordingFrame(pool, {
      frameUuid: frameUuids[0] as string,
      liveSessionId,
      tMs: 9999,
    });
    const count = await pool.query<{ frame_count: number; n: number }>(
      `SELECT fs.frame_count,
              (SELECT count(*)::int FROM frame_set_frame f
               WHERE f.set_id = fs.id) AS n
       FROM frame_set fs WHERE fs.id = $1::uuid`,
      [setUuid]
    );
    expect(count.rows[0]?.frame_count).toBe(2);
    expect(count.rows[0]?.n).toBe(2);
  });

  test("finalize is idempotent and scoped to recording status", async () => {
    await finalizeRecordingSet(pool, liveSessionId);
    await finalizeRecordingSet(pool, liveSessionId);
    const rows = await pool.query<{ status: string }>(
      "SELECT status FROM frame_set WHERE id = $1::uuid",
      [setUuid]
    );
    expect(rows.rows[0]?.status).toBe("final");
  });
});
