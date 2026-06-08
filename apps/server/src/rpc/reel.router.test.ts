import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { createPgLite } from "@sonara/test-utils";
import type { TestPg } from "@sonara/test-utils";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  LiveSessionId,
  ReelId,
  UserId,
} from "@sonara/shared/typeid";
import { createRouterClient } from "@orpc/server";
import { drizzle } from "drizzle-orm/pglite";

import type { ServerHttpContext } from "./procedures";
import type { reelRouter as ReelRouterValue } from "./reel.router";

// presignReadUrl needs S3 env we don't have in tests — mock the bucket so the
// router maps urls without throwing. Must be mocked before reel.router (and its
// frame-mapping import) loads; both import from "../storage/bucket".
mock.module("../storage/bucket", () => ({
  bucketKeyFromUrl: () => null,
  isConfigured: () => true,
  presignReadUrl: (key: string) => `https://signed.test/${key}`,
  uploadBytes: () => Promise.resolve(),
}));

// Minimal DDL for the tables the reel router touches (+ FK targets).
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
`;

type ReelClient = ReturnType<typeof makeClient>;

let pg: TestPg;
let db: Database;
let reelRouter: typeof ReelRouterValue;

const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;
// userA owns A1..A4; userB owns B1.
const A: ImageLibraryId[] = [];
let B1: ImageLibraryId;

// The reel router never touches the registry — an empty stub typed to the
// context shape is enough.
const mkCtx = (userId: UserId): ServerHttpContext => ({
  db,
  registry: {} as ServerHttpContext["registry"],
  session: { user: { id: userId } },
  userId,
});

const makeClient = (userId: UserId) =>
  createRouterClient(reelRouter, { context: mkCtx(userId) });

let a: ReelClient;
let b: ReelClient;

const seedFrame = async (
  owner: UserId,
  i: number
): Promise<ImageLibraryId> => {
  const id = typeIdGenerator("imageLibrary") as ImageLibraryId;
  await db.insert(SCHEMA.imageLibrary).values({
    deck: "wild",
    height: 768,
    id,
    model: "test",
    prompt: `frame ${i}`,
    promptHash: `gen:test:${owner}:${i}`,
    sessionId: "lse_testsession00000000000000" as LiveSessionId,
    source: "generated",
    tMs: i * 1000,
    url: `generated/${owner}/${id}.webp`,
    userId: owner,
    width: 768,
  });
  return id;
};

// pglite's WASM cold-start makes the first hook slow — the default 5s hook
// timeout isn't enough, so the DB-bearing hooks get a generous one.
beforeAll(async () => {
  pg = createPgLite();
  await pg.exec(DDL);
  db = drizzle(pg, { schema: SCHEMA }) as unknown as Database;
  ({ reelRouter } = await import("./reel.router"));
  a = makeClient(userA);
  b = makeClient(userB);

  await db.insert(SCHEMA.user).values([
    { email: "a@test.dev", emailVerified: true, id: userA, name: "A" },
    { email: "b@test.dev", emailVerified: true, id: userB, name: "B" },
  ]);
  for (let i = 0; i < 4; i += 1) {
    A.push(await seedFrame(userA, i));
  }
  B1 = await seedFrame(userB, 99);
}, 30_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM reel_frame; DELETE FROM reel;");
}, 30_000);

const newReel = async (name = "my reel"): Promise<ReelId> => {
  const { reel } = await a.create({ name });
  return reel.id;
};

describe("create / list", () => {
  test("create returns an empty summary and shows up in list", async () => {
    const { reel } = await a.create({ name: "set one" });
    expect(reel.name).toBe("set one");
    expect(reel.frameCount).toBe(0);
    expect(reel.coverUrl).toBeNull();

    const { reels } = await a.list({});
    expect(reels.map((r) => r.id)).toContain(reel.id);
  });

  test("list is per-user — B never sees A's reels", async () => {
    await a.create({ name: "A only" });
    const { reels } = await b.list({});
    expect(reels.length).toBe(0);
  });
});

describe("addFrame", () => {
  test("appends owned frames in order; get returns them by position", async () => {
    const reelId = await newReel();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.addFrame({ frameId: A[1] as ImageLibraryId, reelId });

    const reel = await a.get({ reelId });
    expect(reel.frames.map((f) => f.id)).toEqual([
      A[0] as ImageLibraryId,
      A[1] as ImageLibraryId,
    ]);
    expect(reel.frames[0]?.url).toContain("https://signed.test/");
  });

  test("re-adding the same frame is idempotent (unique reel_id, frame_id)", async () => {
    const reelId = await newReel();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    const reel = await a.get({ reelId });
    expect(reel.frames.length).toBe(1);
  });

  test("cannot add a frame you don't own (NOT_FOUND)", async () => {
    const reelId = await newReel();
    await expect(
      a.addFrame({ frameId: B1, reelId })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("ownership", () => {
  test("B cannot get A's reel (FORBIDDEN)", async () => {
    const reelId = await newReel();
    await expect(b.get({ reelId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  test("B cannot rename / delete / addFrame on A's reel", async () => {
    const reelId = await newReel();
    await expect(
      b.rename({ name: "hijack", reelId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(b.remove({ reelId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      b.addFrame({ frameId: B1, reelId })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  test("unknown reel id → NOT_FOUND", async () => {
    const ghost = typeIdGenerator("reel") as ReelId;
    await expect(a.get({ reelId: ghost })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("reorder", () => {
  test("rewrites authored order", async () => {
    const reelId = await newReel();
    for (const id of A) {
      await a.addFrame({ frameId: id, reelId });
    }
    const reversed = A.toReversed();
    await a.reorder({ orderedFrameIds: reversed, reelId });
    const reel = await a.get({ reelId });
    expect(reel.frames.map((f) => f.id)).toEqual(reversed);
  });

  test("rejects a set that doesn't match the reel's frames (BAD_REQUEST)", async () => {
    const reelId = await newReel();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.addFrame({ frameId: A[1] as ImageLibraryId, reelId });
    await expect(
      a.reorder({ orderedFrameIds: [A[0] as ImageLibraryId], reelId })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("removeFrame / setCover / remove", () => {
  test("removeFrame drops it from the reel", async () => {
    const reelId = await newReel();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.addFrame({ frameId: A[1] as ImageLibraryId, reelId });
    await a.removeFrame({ frameId: A[0] as ImageLibraryId, reelId });
    const reel = await a.get({ reelId });
    expect(reel.frames.map((f) => f.id)).toEqual([A[1] as ImageLibraryId]);
  });

  test("setCover requires the frame to be a member", async () => {
    const reelId = await newReel();
    await expect(
      a.setCover({ frameId: A[0] as ImageLibraryId, reelId })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.setCover({ frameId: A[0] as ImageLibraryId, reelId });
    const reel = await a.get({ reelId });
    expect(reel.coverFrameId).toBe(A[0] as ImageLibraryId);
  });

  test("remove deletes the reel and cascades its frames", async () => {
    const reelId = await newReel();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, reelId });
    await a.remove({ reelId });
    await expect(a.get({ reelId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const rows = await pg.query("SELECT count(*)::int AS n FROM reel_frame");
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });
});
