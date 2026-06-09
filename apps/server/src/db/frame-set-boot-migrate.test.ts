import { beforeAll, describe, expect, test } from "bun:test";

import { DECKS } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";
import { createPgLite, pgliteAsPool } from "@sonara/test-utils";
import type { PoolShim, TestPg } from "@sonara/test-utils";

import type { Logger } from "../lib/logger";
import { migrateFrameSetsOnBoot } from "./frame-set-boot-migrate";

// Tables the converger touches (+ FK targets), including the partial unique
// indexes — ON CONFLICT (deck_key) WHERE origin='builtin' needs the matching
// arbiter index to exist or Postgres rejects the insert with 42P10.
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
CREATE TABLE reel (
  id uuid PRIMARY KEY NOT NULL,
  cover_frame_id uuid REFERENCES image_library(id) ON DELETE set null,
  name text NOT NULL,
  user_id uuid NOT NULL REFERENCES "user"(id) ON DELETE cascade,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reel_frame (
  id uuid PRIMARY KEY NOT NULL,
  frame_id uuid NOT NULL REFERENCES image_library(id) ON DELETE cascade,
  position integer NOT NULL,
  reel_id uuid NOT NULL REFERENCES reel(id) ON DELETE cascade,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reel_frame_reel_position_idx UNIQUE (reel_id, position),
  CONSTRAINT reel_frame_reel_frame_idx UNIQUE (reel_id, frame_id)
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

const noopLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
} as unknown as Logger;

const newFrameUuid = (): string =>
  typeIdToUuid(typeIdGenerator("imageLibrary")).uuid;

let pg: TestPg;
let pool: PoolShim;

const userUuid = typeIdToUuid(typeIdGenerator("user")).uuid;
const sessionId = typeIdGenerator("liveSession") as LiveSessionId;
const reelUuid = typeIdToUuid(typeIdGenerator("reel")).uuid;
const seedFrames = [newFrameUuid(), newFrameUuid()];
const liveFrames = [newFrameUuid(), newFrameUuid(), newFrameUuid()];

const insertFrame = async (opts: {
  id: string;
  deck: string;
  source: "seed" | "generated";
  sessionId?: string;
  tMs?: number | null;
  userId?: string;
}): Promise<void> => {
  await pool.query(
    `INSERT INTO image_library
       (id, deck, prompt, prompt_hash, model, url, width, height, source,
        user_id, session_id, t_ms)
     VALUES ($1::uuid, $2, 'p', $3, 'm', '/library/x.webp', 64, 64, $4,
        $5::uuid, $6, $7)`,
    [
      opts.id,
      opts.deck,
      `hash-${opts.id}`,
      opts.source,
      opts.userId ?? null,
      opts.sessionId ?? null,
      opts.tMs ?? null,
    ]
  );
};

beforeAll(async () => {
  pg = createPgLite();
  await pg.exec(DDL);
  pool = pgliteAsPool(pg);

  await pool.query(
    `INSERT INTO "user" (id, name, email) VALUES ($1::uuid, 'u', 'u@test')`,
    [userUuid]
  );
  // Built-in seed frames for one deck.
  await insertFrame({ deck: "noir", id: seedFrames[0] as string, source: "seed" });
  await insertFrame({ deck: "noir", id: seedFrames[1] as string, source: "seed" });
  // A legacy live session (3 generated frames, out-of-order tMs on purpose).
  await insertFrame({
    deck: "noir",
    id: liveFrames[0] as string,
    sessionId,
    source: "generated",
    tMs: 2500,
    userId: userUuid,
  });
  await insertFrame({
    deck: "noir",
    id: liveFrames[1] as string,
    sessionId,
    source: "generated",
    tMs: 0,
    userId: userUuid,
  });
  await insertFrame({
    deck: "noir",
    id: liveFrames[2] as string,
    sessionId,
    source: "generated",
    tMs: 1000,
    userId: userUuid,
  });
  // A legacy reel holding two of the live frames in authored order.
  await pool.query(
    `INSERT INTO reel (id, name, user_id) VALUES ($1::uuid, 'best of', $2::uuid)`,
    [reelUuid, userUuid]
  );
  await pool.query(
    `INSERT INTO reel_frame (id, reel_id, frame_id, position)
     VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 0),
            (gen_random_uuid(), $1::uuid, $3::uuid, 1)`,
    [reelUuid, liveFrames[2], liveFrames[0]]
  );
});

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
    const extra = newFrameUuid();
    await insertFrame({ deck: "noir", id: extra, source: "seed" });
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
