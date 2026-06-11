import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createRouterClient } from "@orpc/server";
import type {
  ControllableSession,
  ControlSnapshot,
  SessionRegistry,
} from "@sonara/api/server";
import type { Database } from "@sonara/db";
import { defaultScene } from "@sonara/shared";
import {
  typeIdFromUuid,
  typeIdGenerator,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import type { FrameSetId, LiveSessionId, UserId } from "@sonara/shared/typeid";
import { createTestUser, insertSet } from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";

import { stageRooms } from "../stage/stage-rooms";
import type { ServerHttpContext } from "./procedures";
import { setsRouter } from "./sets.router";

// /s/[id] permalink resolver. The registry is the live half of the world — a
// Map of fake ControllableSessions stands in for the SessionManager, while the
// set rows live in the real harness DB. stageRooms is the shared module
// singleton, so every stage a test opens is closed before the test ends.

let t: TestDb;
let db: Database;

const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;

const sessions = new Map<string, ControllableSession>();
const registry: SessionRegistry = {
  getByLiveSessionId: (id) => sessions.get(id),
  getByStageId: (stageId) =>
    [...sessions.values()].find((s) => s.stageId === stageId),
  listByUserId: (rawUserId) =>
    [...sessions.values()].filter((s) => s.userId === rawUserId),
  screenAttached: (stageId) =>
    [...sessions.values()].some((s) => s.stageId === stageId),
};

// Minimal live Session standing — every ControllableSession method is a noop;
// lens only reads userId + getControlSnapshot().
const makeFakeSession = (opts: {
  liveSessionId: LiveSessionId;
  userId: string | null;
}): ControllableSession => {
  const snapshot: ControlSnapshot = {
    currentFrameUrl: "https://signed.test/current.webp",
    currentSource: { kind: "live", label: "neon koi" },
    demoDeck: null,
    demoMode: false,
    imageAnchor: null,
    jobStatus: "running",
    lastFrameUrl: "https://signed.test/last.webp",
    liveSessionId: opts.liveSessionId,
    nowPlaying: null,
    scene: { ...defaultScene, prompt: "neon koi" },
    source: { kind: "live" },
    startedAt: Date.now(),
  };
  return {
    applyPatch: () => {},
    getControlSnapshot: () => snapshot,
    goLive: () => {},
    liveSessionId: opts.liveSessionId,
    notifySource: () => {},
    notifyStage: () => {},
    reset: () => {},
    setCurrentFrame: () => {},
    setCurrentSource: () => {},
    setImageAnchor: () => {},
    setSource: () => {},
    stageId: null,
    startNewRun: () => opts.liveSessionId,
    userId: opts.userId,
  };
};

const mkCtx = (userId: UserId | null): ServerHttpContext =>
  makeServerCtx({ db, registry, userId }) as ServerHttpContext;

const makeClient = (userId: UserId | null) =>
  createRouterClient(setsRouter, { context: mkCtx(userId) });

type ControlClient = ReturnType<typeof makeClient>;
let owner: ControlClient;
let other: ControlClient;
let anon: ControlClient;

// Register a fake live session owned by `userId` (raw-UUID converted, the way
// the WS ticket stores it on the real Session) and return its lse id.
const goLiveAs = (userId: UserId | null): LiveSessionId => {
  const liveSessionId = typeIdGenerator("liveSession") as LiveSessionId;
  sessions.set(
    liveSessionId,
    makeFakeSession({
      liveSessionId,
      userId: userId ? typeIdToUuid(userId).uuid : null,
    })
  );
  return liveSessionId;
};

beforeAll(async () => {
  t = await getTestDb();
  ({ db } = t);
  owner = makeClient(userA);
  other = makeClient(userB);
  anon = makeClient(null);
}, 30_000);

beforeEach(async () => {
  await t.reset();
  sessions.clear();
  await createTestUser(db, { id: userA });
  await createTestUser(db, { id: userB });
}, 30_000);

describe("live tense (registry hit)", () => {
  test("set_ id with a recording row and a live session resolves live", async () => {
    const liveSessionId = goLiveAs(userA);
    const setId = await insertSet(db, {
      liveSessionId,
      name: "friday night",
      origin: "recording",
      status: "recording",
      userId: userA,
    });

    const res = await owner.lens({ id: setId });
    expect(res).toMatchObject({
      exists: true,
      isOwner: true,
      live: {
        currentFrameUrl: "https://signed.test/current.webp",
        jobStatus: "running",
        liveSessionId,
      },
      set: { id: setId, name: "friday night", origin: "recording" },
      tense: "live",
    });
  });

  test("live is readable by anyone holding the id; isOwner stays false", async () => {
    const liveSessionId = goLiveAs(userA);
    const setId = await insertSet(db, {
      liveSessionId,
      origin: "recording",
      userId: userA,
    });

    const asOther = await other.lens({ id: setId });
    expect(asOther).toMatchObject({ isOwner: false, tense: "live" });
    const asAnon = await anon.lens({ id: setId });
    expect(asAnon).toMatchObject({ exists: true, isOwner: false });
  });

  test("open stage rides along; closed stage comes back null", async () => {
    const liveSessionId = goLiveAs(userA);
    const setId = await insertSet(db, {
      liveSessionId,
      origin: "recording",
      userId: userA,
    });

    const room = stageRooms.open(liveSessionId, true);
    try {
      const open = await anon.lens({ id: setId });
      expect(open).toMatchObject({
        stage: { allowPrompts: true, open: true, room, txCount: 0 },
        tense: "live",
      });
    } finally {
      stageRooms.close(room);
    }

    const closed = await anon.lens({ id: setId });
    expect(closed).toMatchObject({ stage: null, tense: "live" });
  });

  test("row-less set_ id resolves through the derived lse uuid (deck-only show)", async () => {
    const liveSessionId = goLiveAs(userA);
    // A recording set's uuid IS its lse uuid by construction — derive the
    // set id the projector link would carry before any frame persists.
    const setId = typeIdFromUuid(
      "frameSet",
      typeIdToUuid(liveSessionId).uuid
    ) as FrameSetId;

    const res = await anon.lens({ id: setId });
    expect(res).toMatchObject({ exists: true, set: null, tense: "live" });
  });

  test("bare lse_ id: live when registered, exists:false when not", async () => {
    const liveSessionId = goLiveAs(null);
    const live = await anon.lens({ id: liveSessionId });
    expect(live).toMatchObject({ set: null, tense: "live" });

    const gone = await anon.lens({ id: typeIdGenerator("liveSession") });
    expect(gone).toEqual({ exists: false });
  });
});

describe("replay tense (no registry hit)", () => {
  test("unlisted recording resolves replay with set meta, no live block", async () => {
    const setId = await insertSet(db, {
      liveSessionId: typeIdGenerator("liveSession") as LiveSessionId,
      name: "last week",
      origin: "recording",
      userId: userA,
      visibility: "unlisted",
    });

    const res = await anon.lens({ id: setId });
    expect(res).toMatchObject({
      exists: true,
      isOwner: false,
      live: null,
      set: { frameCount: 0, id: setId, name: "last week" },
      stage: null,
      tense: "replay",
    });
  });

  test("private set: owner replays, everyone else gets exists:false", async () => {
    const setId = await insertSet(db, {
      liveSessionId: typeIdGenerator("liveSession") as LiveSessionId,
      origin: "recording",
      userId: userA,
      visibility: "private",
    });

    expect(await other.lens({ id: setId })).toEqual({ exists: false });
    expect(await anon.lens({ id: setId })).toEqual({ exists: false });
    expect(await owner.lens({ id: setId })).toMatchObject({
      isOwner: true,
      tense: "replay",
    });
  });
});

describe("malformed ids", () => {
  test("prefix-valid but undecodable id reads as not-found, never a 500", async () => {
    const res = await anon.lens({ id: "set_01jxtest00000000000000000x" });
    expect(res).toEqual({ exists: false });
  });

  test("unknown prefix reads as not-found", async () => {
    const res = await anon.lens({ id: "bogus_12345678" });
    expect(res).toEqual({ exists: false });
  });
});
