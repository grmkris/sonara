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
import {
  createTestUser,
  insertFrame,
  insertLegacyReel,
} from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";

import type { Logger } from "../lib/logger";
import { migrateFrameSetsOnBoot } from "./frame-set-boot-migrate";

// Real schema via the shared harness — migration 0004 creates the legacy
// reel/reel_frame tables, and the migrated frame_set partial unique indexes
// are the arbiters the converger's ON CONFLICT clauses need (42P10
// otherwise). Tests are cumulative (converge → idempotency → rerun-append),
// so reset() runs once in beforeAll, not per test.
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
let reelUuid: string;
const seedFrames: string[] = [];
const liveFrameIds: ImageLibraryId[] = [];
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
  // Built-in seed frames for one deck.
  for (let i = 0; i < 2; i += 1) {
    const id = await insertNoirFrame({ source: "seed" });
    seedFrames.push(typeIdToUuid(id).uuid);
  }
  // A legacy live session (3 generated frames, out-of-order tMs on purpose).
  for (const tMs of [2500, 0, 1000]) {
    const id = await insertNoirFrame({ source: "generated", tMs });
    liveFrameIds.push(id);
    liveFrames.push(typeIdToUuid(id).uuid);
  }
  // A legacy reel holding two of the live frames in authored order.
  const reelId = await insertLegacyReel(db, {
    frames: [
      liveFrameIds[2] as ImageLibraryId,
      liveFrameIds[0] as ImageLibraryId,
    ],
    name: "best of",
    userId,
  });
  reelUuid = typeIdToUuid(reelId).uuid;
}, 30_000);

describe("migrateFrameSetsOnBoot", () => {
  test("converges builtins, recordings and reels into frame_set", async () => {
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
    // One builtin per shipped deck + one recording + one curated copy.
    expect(sets.rows.length).toBe(DECKS.length + 2);

    const noir = sets.rows.find(
      (s) => s.origin === "builtin" && s.deck_key === "noir"
    );
    expect(noir?.visibility).toBe("public");
    expect(noir?.frame_count).toBe(2);

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

    // Curated copy keeps the reel's uuid and authored order.
    const cut = sets.rows.find((s) => s.origin === "curated");
    expect(cut?.id).toBe(reelUuid);
    expect(cut?.frame_count).toBe(2);
    const cutMembers = await pool.query<{ frame_id: string }>(
      `SELECT frame_id FROM frame_set_frame
       WHERE set_id = $1::uuid ORDER BY position ASC`,
      [reelUuid]
    );
    expect(cutMembers.rows.map((m) => m.frame_id)).toEqual([
      liveFrames[2] as string,
      liveFrames[0] as string,
    ]);
  });

  test("is idempotent — a second run adds nothing", async () => {
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const sets = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM frame_set"
    );
    expect(sets.rows[0]?.n).toBe(DECKS.length + 2);
    const members = await pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM frame_set_frame"
    );
    expect(members.rows[0]?.n).toBe(2 + 3 + 2);
  });

  test("appends newly seeded frames past max(position) on rerun", async () => {
    const extra = typeIdToUuid(await insertNoirFrame({ source: "seed" })).uuid;
    await migrateFrameSetsOnBoot(noopLogger, pool);

    const noirMembers = await pool.query<{ frame_id: string; position: number }>(
      `SELECT f.frame_id, f.position FROM frame_set_frame f
       JOIN frame_set s ON s.id = f.set_id
       WHERE s.origin = 'builtin' AND s.deck_key = 'noir'
       ORDER BY f.position ASC`
    );
    expect(noirMembers.rows.length).toBe(3);
    expect(noirMembers.rows.at(-1)?.frame_id).toBe(extra);
  });
});
