import { beforeAll, describe, expect, test } from "bun:test";

import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { createPgLite, pgliteAsPool } from "@sonara/test-utils";
import type { PoolShim, TestPg } from "@sonara/test-utils";

import {
  appendRecordingFrame,
  ensureRecordingSet,
  finalizeRecordingSet,
} from "./recording-set";

// Tables the recording path touches (+ FK targets) — same DDL blocks as
// frame-set-boot-migrate.test.ts, minus the legacy reel tables.
const DDL = `
CREATE TABLE "user" (
  id uuid PRIMARY KEY NOT NULL,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  email_verified boolean NOT NULL DEFAULT false,
  image text,
  dodo_customer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE image_library (
  id uuid PRIMARY KEY NOT NULL,
  deck text NOT NULL,
  prompt text NOT NULL,
  prompt_hash text NOT NULL,
  model text NOT NULL,
  seed integer,
  url text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  palette text[],
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'seed',
  user_id uuid REFERENCES "user"(id) ON DELETE cascade,
  session_id text,
  t_ms integer,
  position integer,
  source_url text,
  trigger_reason text,
  anchor_url text,
  inspector_context jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE frame_set (
  cover_frame_id uuid REFERENCES image_library(id) ON DELETE set null,
  deck_key text,
  frame_count integer NOT NULL DEFAULT 0,
  id uuid PRIMARY KEY NOT NULL,
  live_session_id text,
  name text NOT NULL,
  origin text NOT NULL,
  status text NOT NULL DEFAULT 'final',
  user_id uuid REFERENCES "user"(id) ON DELETE cascade,
  visibility text NOT NULL DEFAULT 'private',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX frame_set_live_session_idx
  ON frame_set (live_session_id) WHERE live_session_id IS NOT NULL;
CREATE UNIQUE INDEX frame_set_deck_key_idx
  ON frame_set (deck_key) WHERE origin = 'builtin';
CREATE TABLE frame_set_frame (
  frame_id uuid NOT NULL REFERENCES image_library(id) ON DELETE cascade,
  id uuid PRIMARY KEY NOT NULL,
  position integer NOT NULL,
  set_id uuid NOT NULL REFERENCES frame_set(id) ON DELETE cascade,
  t_ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT frame_set_frame_set_position_idx UNIQUE (set_id, position),
  CONSTRAINT frame_set_frame_set_frame_idx UNIQUE (set_id, frame_id)
);
`;

let pg: TestPg;
let pool: PoolShim;

const userUuid = typeIdToUuid(typeIdGenerator("user")).uuid;
const liveSessionId = typeIdGenerator("liveSession") as LiveSessionId;
const setUuid = typeIdToUuid(liveSessionId).uuid;
const startedAt = new Date("2026-06-09T14:05:30Z");
const frameUuids = [
  typeIdToUuid(typeIdGenerator("imageLibrary")).uuid,
  typeIdToUuid(typeIdGenerator("imageLibrary")).uuid,
];

beforeAll(async () => {
  pg = createPgLite();
  await pg.exec(DDL);
  pool = pgliteAsPool(pg);

  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1::uuid, 'u', 'u@test')`,
    [userUuid]
  );
  for (const id of frameUuids) {
    await pool.query(
      `INSERT INTO image_library
         (id, deck, prompt, prompt_hash, model, url, width, height, source,
          user_id, session_id)
       VALUES ($1::uuid, 'live', 'p', $2, 'm', '/library/x.webp', 64, 64,
          'generated', $3::uuid, $4)`,
      [id, `hash-${id}`, userUuid, liveSessionId]
    );
  }
});

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
    expect(created.rows[0]?.visibility).toBe("private");

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
