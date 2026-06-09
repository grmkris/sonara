import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";

import { createRouterClient, ORPCError } from "@orpc/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type {
  FrameSetId,
  ImageLibraryId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";
import { createPgLite } from "@sonara/test-utils";
import type { TestPg } from "@sonara/test-utils";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import type { ServerHttpContext } from "./procedures";
import type { setsRouter as SetsRouterValue } from "./sets.router";

// presignReadUrl needs S3 env we don't have in tests — mock the bucket before
// sets.router (and its frame-mapping import) loads.
mock.module("../storage/bucket", () => ({
  bucketKeyFromUrl: () => null,
  isConfigured: () => true,
  presignReadUrl: (key: string) => `https://signed.test/${key}`,
  uploadBytes: () => Promise.resolve(),
}));

// Tables the sets router touches (+ FK targets), incl. the unique indexes the
// idempotent inserts and the reorder offset-bump rely on.
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
let db: Database;
let setsRouter: typeof SetsRouterValue;

const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;
const A: ImageLibraryId[] = [];
let seedFrameId: ImageLibraryId;

const mkCtx = (userId: UserId | null): ServerHttpContext =>
  ({
    db,
    registry: {} as ServerHttpContext["registry"],
    session: userId ? { user: { id: userId } } : null,
    userId: userId as UserId,
  }) as ServerHttpContext;

const makeClient = (userId: UserId | null) =>
  createRouterClient(setsRouter, { context: mkCtx(userId) });

type SetsClient = ReturnType<typeof makeClient>;
let a: SetsClient;
let b: SetsClient;
let anon: SetsClient;

const insertFrame = async (
  owner: UserId | null,
  i: number,
  overrides: Partial<{ source: string; url: string }> = {}
): Promise<ImageLibraryId> => {
  const id = typeIdGenerator("imageLibrary") as ImageLibraryId;
  await db.insert(SCHEMA.imageLibrary).values({
    deck: "wild",
    height: 768,
    id,
    model: "test",
    prompt: `frame ${i}`,
    promptHash: `gen:test:${owner ?? "sys"}:${i}`,
    sessionId: "lse_testsession00000000000000" as LiveSessionId,
    source: (overrides.source ?? "generated") as "generated",
    tMs: i * 1000,
    url: overrides.url ?? `generated/${owner}/${id}.webp`,
    userId: owner,
    width: 768,
  });
  return id;
};

beforeAll(async () => {
  pg = createPgLite();
  await pg.exec(DDL);
  db = drizzle(pg, { schema: SCHEMA }) as unknown as Database;
  ({ setsRouter } = await import("./sets.router"));
  a = makeClient(userA);
  b = makeClient(userB);
  anon = makeClient(null);

  await db.insert(SCHEMA.user).values([
    { email: "a@test.dev", emailVerified: true, id: userA, name: "A" },
    { email: "b@test.dev", emailVerified: true, id: userB, name: "B" },
  ]);
  for (let i = 0; i < 4; i += 1) {
    A.push(await insertFrame(userA, i));
  }
  seedFrameId = await insertFrame(null, 50, {
    source: "seed",
    url: "/library/wild/img_test.webp",
  });
}, 30_000);

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec("DELETE FROM frame_set_frame; DELETE FROM frame_set;");
}, 30_000);

const newCut = async (name = "my cut"): Promise<FrameSetId> => {
  const { set } = await a.create({ name });
  return set.id;
};

// Insert a recording / builtin row directly (those are created by the boot
// converger or the live path, not by this router).
const insertSet = async (opts: {
  origin: "builtin" | "recording" | "curated";
  userId?: UserId | null;
  visibility?: "private" | "unlisted" | "public";
  deckKey?: string;
  liveSessionId?: string;
  frames?: { id: ImageLibraryId; tMs?: number }[];
}): Promise<FrameSetId> => {
  const [row] = await db
    .insert(SCHEMA.frameSet)
    .values({
      deckKey: opts.deckKey,
      frameCount: opts.frames?.length ?? 0,
      liveSessionId: opts.liveSessionId as LiveSessionId | undefined,
      name: `${opts.origin} set`,
      origin: opts.origin,
      userId: opts.userId ?? null,
      visibility: opts.visibility ?? "private",
    })
    .returning();
  const setId = (row as { id: FrameSetId }).id;
  if (opts.frames?.length) {
    await db.insert(SCHEMA.frameSetFrame).values(
      opts.frames.map((f, i) => ({
        frameId: f.id,
        position: i,
        setId,
        tMs: f.tMs ?? null,
      }))
    );
  }
  return setId;
};

describe("create / list / get", () => {
  test("create returns an empty summary and shows up in list", async () => {
    const { set } = await a.create({ name: "cut one" });
    expect(set.name).toBe("cut one");
    expect(set.origin).toBe("curated");
    expect(set.frameCount).toBe(0);

    const { sets } = await a.list({});
    expect(sets.map((s) => s.id)).toContain(set.id);
  });

  test("list is per-user but everyone sees builtins", async () => {
    await a.create({ name: "A only" });
    const builtinId = await insertSet({
      deckKey: "wild",
      origin: "builtin",
      visibility: "public",
    });
    const { sets } = await b.list({});
    expect(sets.map((s) => s.id)).toEqual([builtinId]);
  });

  test("origin filter narrows the list", async () => {
    await a.create({ name: "a cut" });
    await insertSet({ deckKey: "wild", origin: "builtin", visibility: "public" });
    const { sets } = await a.list({ origin: "curated" });
    expect(sets.every((s) => s.origin === "curated")).toBe(true);
    expect(sets.length).toBe(1);
  });
});

describe("addFrame / removeFrame / frameCount", () => {
  test("appends owned frames in order and maintains frameCount", async () => {
    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    await a.addFrame({ frameId: A[1] as ImageLibraryId, setId });

    const set = await a.get({ setId });
    expect(set.frames.map((f) => f.id)).toEqual([
      A[0] as ImageLibraryId,
      A[1] as ImageLibraryId,
    ]);
    expect(set.frameCount).toBe(2);

    await a.removeFrame({ frameId: A[0] as ImageLibraryId, setId });
    const after = await a.get({ setId });
    expect(after.frameCount).toBe(1);
  });

  test("re-adding the same frame is idempotent and doesn't double-count", async () => {
    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    const set = await a.get({ setId });
    expect(set.frames.length).toBe(1);
    expect(set.frameCount).toBe(1);
  });

  test("cannot add someone else's frame", async () => {
    const setId = await newCut();
    expect(
      b.addFrame({ frameId: A[0] as ImageLibraryId, setId })
    ).rejects.toThrow(ORPCError);
  });
});

describe("freeze policy", () => {
  test("recording frame list is frozen; metadata stays editable", async () => {
    const recId = await insertSet({
      frames: [{ id: A[0] as ImageLibraryId, tMs: 0 }],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    expect(
      a.addFrame({ frameId: A[1] as ImageLibraryId, setId: recId })
    ).rejects.toThrow("frozen");
    expect(
      a.reorder({ orderedFrameIds: [A[0] as ImageLibraryId], setId: recId })
    ).rejects.toThrow("frozen");
    await a.rename({ name: "friday night", setId: recId });
    await a.setVisibility({ setId: recId, visibility: "public" });
    const set = await a.get({ setId: recId });
    expect(set.name).toBe("friday night");
    expect(set.visibility).toBe("public");
  });

  test("builtin sets are immutable for everyone", async () => {
    const builtinId = await insertSet({
      deckKey: "wild",
      origin: "builtin",
      visibility: "public",
    });
    expect(a.rename({ name: "mine now", setId: builtinId })).rejects.toThrow(
      ORPCError
    );
    expect(a.remove({ setId: builtinId })).rejects.toThrow(ORPCError);
  });
});

describe("public get + visibility", () => {
  test("private sets 404 for other users and anon; owner reads fine", async () => {
    const setId = await newCut("private cut");
    await expect(a.get({ setId })).resolves.toMatchObject({
      name: "private cut",
    });
    expect(b.get({ setId })).rejects.toThrow("not found");
    expect(anon.get({ setId })).rejects.toThrow("not found");
  });

  test("unlisted/public sets are readable by anon", async () => {
    const setId = await newCut("shared cut");
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    await a.setVisibility({ setId, visibility: "unlisted" });
    const set = await anon.get({ setId });
    expect(set.frames.length).toBe(1);
  });

  test("recording get returns the junction tMs (original timing)", async () => {
    const recId = await insertSet({
      frames: [
        { id: A[1] as ImageLibraryId, tMs: 0 },
        { id: A[0] as ImageLibraryId, tMs: 4200 },
      ],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
      visibility: "public",
    });
    const set = await anon.get({ setId: recId });
    expect(set.frames.map((f) => f.tMs)).toEqual([0, 4200]);
  });

  test("seed-frame urls pass through unsigned; bucket keys get presigned", async () => {
    const builtinId = await insertSet({
      deckKey: "wild",
      frames: [{ id: seedFrameId }],
      origin: "builtin",
      visibility: "public",
    });
    const builtin = await anon.get({ setId: builtinId });
    expect(builtin.frames[0]?.url).toBe("/library/wild/img_test.webp");

    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    const cut = await a.get({ setId });
    expect(cut.frames[0]?.url).toContain("https://signed.test/");
  });
});

describe("make a cut (create from a source set)", () => {
  test("copies the source's frames in order", async () => {
    const recId = await insertSet({
      frames: [
        { id: A[2] as ImageLibraryId, tMs: 0 },
        { id: A[0] as ImageLibraryId, tMs: 1000 },
        { id: A[3] as ImageLibraryId, tMs: 2000 },
      ],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    const { set } = await a.create({ fromSetId: recId, name: "the cut" });
    expect(set.frameCount).toBe(3);
    const cut = await a.get({ setId: set.id });
    expect(cut.origin).toBe("curated");
    expect(cut.frames.map((f) => f.id)).toEqual([
      A[2] as ImageLibraryId,
      A[0] as ImageLibraryId,
      A[3] as ImageLibraryId,
    ]);
    // Cuts are fixed-cadence: junction tMs is not carried over.
    expect(cut.frames.every((f) => f.tMs === 0)).toBe(true);
  });

  test("cannot cut from someone else's private set; public is fair game", async () => {
    const privateId = await insertSet({
      frames: [{ id: A[0] as ImageLibraryId }],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    expect(
      b.create({ fromSetId: privateId, name: "steal" })
    ).rejects.toThrow("not found");

    const builtinId = await insertSet({
      deckKey: "wild",
      frames: [{ id: seedFrameId }],
      origin: "builtin",
      visibility: "public",
    });
    const { set } = await b.create({ fromSetId: builtinId, name: "remix" });
    expect(set.frameCount).toBe(1);
  });
});

describe("reorder", () => {
  test("rewrites the authored order; rejects a mismatched multiset", async () => {
    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    await a.addFrame({ frameId: A[1] as ImageLibraryId, setId });
    await a.addFrame({ frameId: A[2] as ImageLibraryId, setId });

    await a.reorder({
      orderedFrameIds: [
        A[2] as ImageLibraryId,
        A[0] as ImageLibraryId,
        A[1] as ImageLibraryId,
      ],
      setId,
    });
    const set = await a.get({ setId });
    expect(set.frames.map((f) => f.id)).toEqual([
      A[2] as ImageLibraryId,
      A[0] as ImageLibraryId,
      A[1] as ImageLibraryId,
    ]);

    expect(
      a.reorder({ orderedFrameIds: [A[0] as ImageLibraryId], setId })
    ).rejects.toThrow("must match");
  });
});

describe("ownership", () => {
  test("B cannot mutate or delete A's set", async () => {
    const setId = await newCut();
    expect(b.rename({ name: "nope", setId })).rejects.toThrow(ORPCError);
    expect(b.remove({ setId })).rejects.toThrow(ORPCError);
    expect(
      b.setVisibility({ setId, visibility: "public" })
    ).rejects.toThrow(ORPCError);
  });

  test("remove deletes the set but never the frames", async () => {
    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    await a.remove({ setId });
    expect(a.get({ setId })).rejects.toThrow("not found");
    const frames = await db
      .select({ id: SCHEMA.imageLibrary.id })
      .from(SCHEMA.imageLibrary)
      .where(eq(SCHEMA.imageLibrary.id, A[0] as ImageLibraryId));
    expect(frames.length).toBe(1);
  });
});
