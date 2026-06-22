import { beforeAll, describe, expect, test } from "bun:test";

import type { Database } from "@sonara/db";
import { DECKS } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";
import type { PoolShim } from "@sonara/test-utils";
import { createTestUser, insertFrame } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";

import type { Logger } from "../lib/logger";
import { migrateFrameSetsOnBoot } from "./frame-set-boot-migrate";

// Real schema via the shared harness — migrations 0000–0006 run in full, so
// the legacy reel/reel_frame tables are created (0004) and then copy-then-
// dropped (0006) inside every test run; the migrated frame_set partial
// unique indexes are the arbiters the converger's ON CONFLICT clauses need
// (42P10 otherwise). Tests are cumulative (converge → idempotency →
// rerun-append), so reset() runs once in beforeAll, not per test.
const noopLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
} as unknown as Logger;

let db: Database;
let pool: PoolShim;

const userId = typeIdGenerator("user") as UserId;
const sessionId = typeIdGenerator("liveSession") as LiveSessionId;
const seedFrames: string[] = [];
const liveFrames: string[] = [];

const insertNoirFrame = (opts: {
  source: "generated" | "seed";
  tMs?: number;
}): Promise<ImageLibraryId> =>
  insertFrame(db, {
    deck: "noir",
    sessionId: opts.source === "generated" ? sessionId : undefined,
    source: opts.source,
    tMs: opts.tMs,
    url: "/library/x.webp",
    userId: opts.source === "generated" ? userId : undefined,
  });

beforeAll(async () => {
  const t = await getTestDb();
  ({ db, pool } = t);
  await t.reset();

  await createTestUser(db, { id: userId });
  // Built-in seed frames for one deck. Sequential: single-connection PGlite
  // test DB — parallel inserts would contend, and counts here are tiny.
  /* oxlint-disable no-await-in-loop */
  for (let i = 0; i < 2; i += 1) {
    const id = await insertNoirFrame({ source: "seed" });
    seedFrames.push(typeIdToUuid(id).uuid);
  }
  // A legacy live session (3 generated frames, out-of-order tMs on purpose).
  for (const tMs of [2500, 0, 1000]) {
    const id = await insertNoirFrame({ source: "generated", tMs });
    liveFrames.push(typeIdToUuid(id).uuid);
  }
  /* oxlint-enable no-await-in-loop */
}, 30_000);

describe("migrateFrameSetsOnBoot", () => {
  test("the legacy reel tables are gone after migrations (0006 ran)", async () => {
    // Pins that the harness actually applied the copy-then-drop migration —
    // the reel/reel_frame tables exist mid-run (0004) but must not survive.
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('reel', 'reel_frame')`
    );
    expect(tables.rows.length).toBe(0);
  });

  test("converges builtins and recordings into frame_set", async () => {
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const sets = await pool.query<{
      deck_key: string | null;
      frame_count: number;
      id: string;
      live_session_id: string | null;
      origin: string;
      visibility: string;
    }>(`SELECT id, deck_key, frame_count, live_session_id, origin, visibility
        FROM frame_set`);
    // One builtin per shipped deck + one recording.
    expect(sets.rows.length).toBe(DECKS.length + 1);

    const noir = sets.rows.find(
      (s) => s.origin === "builtin" && s.deck_key === "noir"
    );
    expect(noir?.visibility).toBe("public");
    expect(noir?.frame_count).toBe(2);

    // Builtins with a DECK_LOOK entry carry the baked look; those without
    // keep null look columns (= app defaults, never frozen). All carry the
    // style drift string.
    const looks = await pool.query<{
      deck_key: string;
      look_cadence_calm_ms: number | null;
      look_cadence_loud_ms: number | null;
      look_intensity: number | null;
      look_preset: string | null;
      style_drift: string | null;
    }>(`SELECT deck_key, look_preset, look_intensity, look_cadence_calm_ms,
               look_cadence_loud_ms, style_drift
        FROM frame_set WHERE origin = 'builtin'
          AND deck_key IN ('noir', 'wild')`);
    const noirLook = looks.rows.find((r) => r.deck_key === "noir");
    expect(noirLook?.look_preset).toBe("noir");
    expect(noirLook?.look_intensity).toBeCloseTo(0.15);
    expect(noirLook?.look_cadence_calm_ms).toBe(12_000);
    expect(noirLook?.look_cadence_loud_ms).toBe(7000);
    expect(noirLook?.style_drift).toContain("noir");
    const wildLook = looks.rows.find((r) => r.deck_key === "wild");
    expect(wildLook?.look_preset).toBeNull();
    expect(wildLook?.look_intensity).toBeNull();
    expect(wildLook?.style_drift).toContain("wildlife");

    // Recording set id is derived from the lse_ uuid (deterministic).
    const recording = sets.rows.find((s) => s.origin === "recording");
    expect(recording?.id).toBe(typeIdToUuid(sessionId).uuid);
    expect(recording?.live_session_id).toBe(sessionId);
    expect(recording?.frame_count).toBe(3);

    // Members are ordered by tMs and carry it for original-timing replay.
    const members = await pool.query<{ frame_id: string; t_ms: number }>(
      `SELECT frame_id, t_ms FROM frame_set_frame
       WHERE set_id = $1::uuid ORDER BY position ASC`,
      [recording?.id]
    );
    expect(members.rows.map((m) => m.t_ms)).toEqual([0, 1000, 2500]);
    expect(members.rows[0]?.frame_id).toBe(liveFrames[1] as string);
  });

  test("is idempotent — a second run adds nothing", async () => {
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const sets = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM frame_set"
    );
    expect(sets.rows[0]?.n).toBe(DECKS.length + 1);
    const members = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM frame_set_frame"
    );
    // 2 builtin (noir seed) + 3 recording members.
    expect(members.rows[0]?.n).toBe(2 + 3);
  });

  test("re-converges a drifted builtin look on rerun", async () => {
    await pool.query(
      `UPDATE frame_set SET look_preset = 'rave', look_intensity = 0.9
       WHERE origin = 'builtin' AND deck_key = 'noir'`
    );
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const noir = await pool.query<{
      look_intensity: number | null;
      look_preset: string | null;
    }>(
      `SELECT look_preset, look_intensity FROM frame_set
       WHERE origin = 'builtin' AND deck_key = 'noir'`
    );
    expect(noir.rows[0]?.look_preset).toBe("noir");
    expect(noir.rows[0]?.look_intensity).toBeCloseTo(0.15);
  });

  test("appends newly seeded frames past max(position) on rerun", async () => {
    const extra = typeIdToUuid(await insertNoirFrame({ source: "seed" })).uuid;
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const noirMembers = await pool.query<{
      frame_id: string;
      position: number;
    }>(
      `SELECT f.frame_id, f.position FROM frame_set_frame f
       JOIN frame_set s ON s.id = f.set_id
       WHERE s.origin = 'builtin' AND s.deck_key = 'noir'
       ORDER BY f.position ASC`
    );
    expect(noirMembers.rows.length).toBe(3);
    expect(noirMembers.rows.at(-1)?.frame_id).toBe(extra);
  });
});
