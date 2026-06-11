import { beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";

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
import {
  createTestUser,
  insertFrame,
  insertSet as insertSetRow,
} from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";
import { eq } from "drizzle-orm";

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

let t: TestDb;
let db: Database;
let setsRouter: typeof SetsRouterValue;

const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;
const sessionId = typeIdGenerator("liveSession") as LiveSessionId;
const A: ImageLibraryId[] = [];
let seedFrameId: ImageLibraryId;

const mkCtx = (userId: UserId | null): ServerHttpContext =>
  makeServerCtx({ db, userId }) as ServerHttpContext;

const makeClient = (userId: UserId | null) =>
  createRouterClient(setsRouter, { context: mkCtx(userId) });

type SetsClient = ReturnType<typeof makeClient>;
let a: SetsClient;
let b: SetsClient;
let anon: SetsClient;

beforeAll(async () => {
  t = await getTestDb();
  ({ db } = t);
  ({ setsRouter } = await import("./sets.router"));
  a = makeClient(userA);
  b = makeClient(userB);
  anon = makeClient(null);
}, 30_000);

// The shared reset() truncates everything (users and frames included), so the
// base fixtures are re-seeded per test rather than once in beforeAll.
beforeEach(async () => {
  await t.reset();
  await createTestUser(db, { email: "a@test.dev", id: userA, name: "A" });
  await createTestUser(db, { email: "b@test.dev", id: userB, name: "B" });
  A.length = 0;
  for (let i = 0; i < 4; i += 1) {
    A.push(
      await insertFrame(db, { sessionId, tMs: i * 1000, userId: userA })
    );
  }
  seedFrameId = await insertFrame(db, {
    source: "seed",
    tMs: 50_000,
    url: "/library/wild/img_test.webp",
  });
}, 30_000);

const newCut = async (name = "my cut"): Promise<FrameSetId> => {
  const { set } = await a.create({ name });
  return set.id;
};

const insertSet = (opts: {
  origin: "builtin" | "recording" | "curated";
  userId?: UserId | null;
  visibility?: "private" | "unlisted" | "public";
  deckKey?: string;
  liveSessionId?: LiveSessionId;
  frames?: { id: ImageLibraryId; tMs?: number }[];
}): Promise<FrameSetId> => insertSetRow(db, opts);

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

describe("addFrames (batch)", () => {
  test("appends in input order and reports the insert count", async () => {
    const setId = await newCut();
    const { added } = await a.addFrames({
      frameIds: [
        A[2] as ImageLibraryId,
        A[0] as ImageLibraryId,
        A[3] as ImageLibraryId,
      ],
      setId,
    });
    expect(added).toBe(3);
    const set = await a.get({ setId });
    expect(set.frames.map((f) => f.id)).toEqual([
      A[2] as ImageLibraryId,
      A[0] as ImageLibraryId,
      A[3] as ImageLibraryId,
    ]);
    expect(set.frameCount).toBe(3);
  });

  test("overlapping re-add counts only the new frames", async () => {
    const setId = await newCut();
    await a.addFrame({ frameId: A[0] as ImageLibraryId, setId });
    const { added } = await a.addFrames({
      frameIds: [
        A[0] as ImageLibraryId,
        A[1] as ImageLibraryId,
        A[2] as ImageLibraryId,
      ],
      setId,
    });
    expect(added).toBe(2);
    const set = await a.get({ setId });
    expect(set.frames.map((f) => f.id)).toEqual([
      A[0] as ImageLibraryId,
      A[1] as ImageLibraryId,
      A[2] as ImageLibraryId,
    ]);
    expect(set.frameCount).toBe(3);

    // Full overlap: nothing inserted, count untouched.
    const again = await a.addFrames({
      frameIds: [A[1] as ImageLibraryId, A[2] as ImageLibraryId],
      setId,
    });
    expect(again.added).toBe(0);
    const unchanged = await a.get({ setId });
    expect(unchanged.frameCount).toBe(3);
  });

  test("a foreign frame anywhere rejects the whole batch — nothing inserted", async () => {
    const setId = await newCut();
    const foreign = await insertFrame(db, { tMs: 0, userId: userB });
    expect(
      a.addFrames({
        frameIds: [A[0] as ImageLibraryId, foreign, A[1] as ImageLibraryId],
        setId,
      })
    ).rejects.toThrow("not found");
    const set = await a.get({ setId });
    expect(set.frames.length).toBe(0);
    expect(set.frameCount).toBe(0);
  });

  test("recording sets are frozen for batch adds too", async () => {
    const recId = await insertSet({
      frames: [{ id: A[0] as ImageLibraryId, tMs: 0 }],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    expect(
      a.addFrames({ frameIds: [A[1] as ImageLibraryId], setId: recId })
    ).rejects.toThrow("frozen");
  });
});

describe("create with frameIds (new set from selection)", () => {
  test("seeds the new set with the given frames in input order", async () => {
    const { set } = await a.create({
      frameIds: [
        A[3] as ImageLibraryId,
        A[1] as ImageLibraryId,
        A[0] as ImageLibraryId,
      ],
      name: "selection cut",
    });
    expect(set.frameCount).toBe(3);
    const cut = await a.get({ setId: set.id });
    expect(cut.origin).toBe("curated");
    expect(cut.frames.map((f) => f.id)).toEqual([
      A[3] as ImageLibraryId,
      A[1] as ImageLibraryId,
      A[0] as ImageLibraryId,
    ]);
  });

  test("ownership is enforced on seed frames", async () => {
    const foreign = await insertFrame(db, { tMs: 0, userId: userB });
    expect(
      a.create({
        frameIds: [A[0] as ImageLibraryId, foreign],
        name: "steal frames",
      })
    ).rejects.toThrow("not found");
  });

  test("frameIds wins over fromSetId when both are given", async () => {
    const recId = await insertSet({
      frames: [
        { id: A[0] as ImageLibraryId, tMs: 0 },
        { id: A[1] as ImageLibraryId, tMs: 1000 },
      ],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    const { set } = await a.create({
      frameIds: [A[2] as ImageLibraryId],
      fromSetId: recId,
      name: "both seeds",
    });
    expect(set.frameCount).toBe(1);
    const cut = await a.get({ setId: set.id });
    expect(cut.frames.map((f) => f.id)).toEqual([A[2] as ImageLibraryId]);
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

describe("addFrames atPosition (splice) + removeFrames", () => {
  const orderOf = async (setId: FrameSetId): Promise<string[]> => {
    const set = await a.get({ setId });
    return set.frames.map((f) => f.id);
  };

  const seeded = async (): Promise<FrameSetId> => {
    const setId = await newCut("splice target");
    await a.addFrames({
      frameIds: [A[0], A[1], A[2]] as ImageLibraryId[],
      setId,
    });
    return setId;
  };

  test("middle insert lands the block at the display index", async () => {
    const setId = await seeded();
    const { added } = await a.addFrames({
      atPosition: 1,
      frameIds: [A[3] as ImageLibraryId],
      setId,
    });
    expect(added).toBe(1);
    expect(await orderOf(setId)).toEqual([A[0], A[3], A[1], A[2]]);
    const set = await a.get({ setId });
    expect(set.frameCount).toBe(4);
  });

  test("atPosition 0 prepends; out-of-range clamps to append", async () => {
    const setId = await newCut("clamp");
    await a.addFrames({ frameIds: [A[0]] as ImageLibraryId[], setId });
    await a.addFrames({
      atPosition: 0,
      frameIds: [A[1]] as ImageLibraryId[],
      setId,
    });
    expect(await orderOf(setId)).toEqual([A[1], A[0]]);
    await a.addFrames({
      atPosition: 99,
      frameIds: [A[2]] as ImageLibraryId[],
      setId,
    });
    expect(await orderOf(setId)).toEqual([A[1], A[0], A[2]]);
  });

  test("gap safety: splice at an index whose raw positions have gaps", async () => {
    const setId = await newCut("gappy");
    const extra = await insertFrame(db, { userId: userA });
    await a.addFrames({
      frameIds: [A[0], A[1], A[2], A[3]] as ImageLibraryId[],
      setId,
    });
    // removeFrame leaves a raw-position gap at index 1.
    await a.removeFrame({ frameId: A[1] as ImageLibraryId, setId });
    expect(await orderOf(setId)).toEqual([A[0], A[2], A[3]]);
    await a.addFrames({ atPosition: 1, frameIds: [extra], setId });
    expect(await orderOf(setId)).toEqual([A[0], extra, A[2], A[3]]);
  });

  test("splice dedupes against members without moving them", async () => {
    const setId = await seeded();
    const extra = await insertFrame(db, { userId: userA });
    const { added } = await a.addFrames({
      atPosition: 0,
      frameIds: [A[2] as ImageLibraryId, extra],
      setId,
    });
    expect(added).toBe(1);
    expect(await orderOf(setId)).toEqual([extra, A[0], A[1], A[2]]);
  });

  test("multi-frame block keeps its order at the splice point", async () => {
    const setId = await newCut("block");
    const e1 = await insertFrame(db, { userId: userA });
    const e2 = await insertFrame(db, { userId: userA });
    await a.addFrames({ frameIds: [A[0], A[1]] as ImageLibraryId[], setId });
    await a.addFrames({ atPosition: 1, frameIds: [e1, e2], setId });
    expect(await orderOf(setId)).toEqual([A[0], e1, e2, A[1]]);
  });

  test("splice respects the freeze policy and frame ownership", async () => {
    const recId = await insertSet({
      frames: [{ id: A[0] as ImageLibraryId, tMs: 0 }],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    expect(
      a.addFrames({
        atPosition: 0,
        frameIds: [A[1] as ImageLibraryId],
        setId: recId,
      })
    ).rejects.toThrow("frozen");
    const setId = await newCut("foreign");
    const foreign = await insertFrame(db, { userId: userB });
    expect(
      a.addFrames({ atPosition: 0, frameIds: [foreign], setId })
    ).rejects.toThrow("not found");
  });

  test("removeFrames drops members in one call; non-members skipped", async () => {
    const setId = await seeded();
    const stranger = await insertFrame(db, { userId: userA });
    const { removed } = await a.removeFrames({
      frameIds: [A[0] as ImageLibraryId, A[2] as ImageLibraryId, stranger],
      setId,
    });
    expect(removed).toBe(2);
    expect(await orderOf(setId)).toEqual([A[1]]);
    const set = await a.get({ setId });
    expect(set.frameCount).toBe(1);
    // Frozen recordings reject batch removal too.
    const recId = await insertSet({
      frames: [{ id: A[0] as ImageLibraryId, tMs: 0 }],
      liveSessionId: typeIdGenerator("liveSession"),
      origin: "recording",
      userId: userA,
    });
    expect(
      a.removeFrames({ frameIds: [A[0] as ImageLibraryId], setId: recId })
    ).rejects.toThrow("frozen");
  });

  test("undo round-trip: removeFrames then addFrames(atPosition) restores order", async () => {
    const setId = await newCut("undo");
    await a.addFrames({
      frameIds: [A[0], A[1], A[2], A[3]] as ImageLibraryId[],
      setId,
    });
    await a.removeFrames({
      frameIds: [A[1], A[2]] as ImageLibraryId[],
      setId,
    });
    expect(await orderOf(setId)).toEqual([A[0], A[3]]);
    await a.addFrames({
      atPosition: 1,
      frameIds: [A[1], A[2]] as ImageLibraryId[],
      setId,
    });
    expect(await orderOf(setId)).toEqual([A[0], A[1], A[2], A[3]]);
  });
});
