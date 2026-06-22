import { beforeAll, beforeEach, describe, expect, test } from "bun:test";

import { createRouterClient, ORPCError } from "@orpc/server";
import type {
  ControllableSession,
  ControlSnapshot,
  SessionRegistry,
} from "@sonara/api/server";
import type { Database } from "@sonara/db";
import type { ClientScenePatch } from "@sonara/shared";
import { defaultScene } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { LiveSessionId, StageId, UserId } from "@sonara/shared/typeid";
import {
  createTestStage,
  createTestUser,
  insertFrame,
  insertSet,
} from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";

import { controlRouter } from "./control.router";
import type { ServerHttpContext } from "./procedures";

// Ownership semantics, exercised through the router's stage-keyed targeting:
// unknown stage → NOT_FOUND, someone else's stage → FORBIDDEN, own stage →
// the call reaches the Session. The registry stub IS the liveness world; the
// ctx carries the harness db for the stage-row ownership lookups.

let db: Database;

const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;

interface PatchCall {
  origin?: "client" | "voice";
  patch: ClientScenePatch;
}

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

// Fake Session that records applyPatch calls so "own session succeeds" can
// assert the mutation actually landed, not just that no error was thrown.
const registerSession = (
  ownerId: UserId,
  stageId: StageId | null = null
): {
  calls: PatchCall[];
  liveSessionId: LiveSessionId;
  sourceCalls: unknown[];
} => {
  const liveSessionId = typeIdGenerator("liveSession") as LiveSessionId;
  const sourceCalls: unknown[] = [];
  const calls: PatchCall[] = [];
  const snapshot: ControlSnapshot = {
    currentFrameUrl: null,
    currentSource: null,
    imageAnchor: null,
    jobStatus: "idle",
    lastFrameUrl: null,
    liveSessionId,
    nowPlaying: null,
    scene: defaultScene,
    source: { kind: "idle" },
    startedAt: Date.now(),
  };
  sessions.set(liveSessionId, {
    applyPatch: (patch, origin) => {
      calls.push({ origin, patch });
    },
    getControlSnapshot: () => snapshot,
    goLive: () => {},
    liveSessionId,
    notifyLook: () => {},
    notifySource: (source) => {
      sourceCalls.push(source);
    },
    notifyStage: () => {},
    reset: () => {},
    setCurrentFrame: () => {},
    setCurrentSource: () => {},
    setImageAnchor: () => {},
    setSource: () => {},
    stageId,
    startNewRun: () => typeIdGenerator("liveSession") as LiveSessionId,
    userId: typeIdToUuid(ownerId).uuid,
  });
  return { calls, liveSessionId, sourceCalls };
};

const makeClient = (userId: UserId | null) =>
  createRouterClient(controlRouter, {
    context: makeServerCtx({ db, registry, userId }) as ServerHttpContext,
  });

type ControlClient = ReturnType<typeof makeClient>;
let a: ControlClient;
let b: ControlClient;

const errorCodeOf = async (p: Promise<unknown>): Promise<string | null> => {
  try {
    await p;
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    return (error as { code: string }).code;
  }
};

let stageA: { code: string; id: StageId };

beforeAll(async () => {
  const t = await getTestDb();
  ({ db } = t);
  await t.reset();
  await createTestUser(db, { id: userA });
  await createTestUser(db, { id: userB });
  stageA = await createTestStage(db, { name: "Main floor", userId: userA });
  a = makeClient(userA);
  b = makeClient(userB);
}, 30_000);

beforeEach(() => {
  sessions.clear();
});

describe("stage-keyed targeting", () => {
  test("anonymous caller → UNAUTHORIZED before any lookup", async () => {
    registerSession(userA, stageA.id);
    const code = await errorCodeOf(
      makeClient(null).snapshot({ stageId: stageA.id })
    );
    expect(code).toBe("UNAUTHORIZED");
  });

  test("owned + live stage: scenePatch lands via { stageId }", async () => {
    const { calls } = registerSession(userA, stageA.id);
    await a.scenePatch({ patch: { prompt: "via stage" }, stageId: stageA.id });
    expect(calls).toEqual([
      { origin: "client", patch: { prompt: "via stage" } },
    ]);
  });

  test("someone else's stage → FORBIDDEN before liveness leaks", async () => {
    registerSession(userA, stageA.id);
    const code = await errorCodeOf(
      b.scenePatch({ patch: { prompt: "mine" }, stageId: stageA.id })
    );
    expect(code).toBe("FORBIDDEN");
  });

  test("owned stage with no live run → NOT_FOUND", async () => {
    const code = await errorCodeOf(a.snapshot({ stageId: stageA.id }));
    expect(code).toBe("NOT_FOUND");
  });

  test("unknown stage id → NOT_FOUND", async () => {
    const code = await errorCodeOf(
      a.snapshot({ stageId: typeIdGenerator("stage") })
    );
    expect(code).toBe("NOT_FOUND");
  });

  test("stages() lists DB rows decorated with liveness", async () => {
    registerSession(userA, stageA.id);
    const { stages } = await a.stages();
    const mine = stages.find((s) => s.stageId === stageA.id);
    expect(mine).toMatchObject({
      code: stageA.code,
      live: true,
      name: "Main floor",
    });
    // userB has no stages and sees none of userA's.
    const theirs = await b.stages();
    expect(theirs.stages.find((s) => s.stageId === stageA.id)).toBeUndefined();
  });

  test("newSet returns the fresh run id", async () => {
    const { liveSessionId } = registerSession(userA, stageA.id);
    const { liveSessionId: next } = await a.newSet({ stageId: stageA.id });
    expect(next).not.toBe(liveSessionId);
  });

  test("setSource relays a readable set and rejects a foreign private one", async () => {
    const { sourceCalls } = registerSession(userA, stageA.id);
    const frame = await insertFrame(db, { userId: userA });
    const mineSet = await insertSet(db, {
      frames: [{ id: frame }],
      name: "my cut",
      origin: "curated",
      userId: userA,
      visibility: "private",
    });
    await a.setSource({
      source: { kind: "set", label: null, setId: mineSet },
      stageId: stageA.id,
    });
    expect(sourceCalls).toEqual([
      { kind: "set", label: "my cut", setId: mineSet },
    ]);

    const foreignPrivate = await insertSet(db, {
      name: "theirs",
      origin: "curated",
      userId: userB,
      visibility: "private",
    });
    const code = await errorCodeOf(
      a.setSource({
        source: { kind: "set", label: null, setId: foreignPrivate },
        stageId: stageA.id,
      })
    );
    expect(code).toBe("NOT_FOUND");

    // Builtin sets relay with their deckKey so the screen plays the static
    // manifest directly (no fetch — the offline path).
    const builtin = await insertSet(db, {
      deckKey: "noir",
      name: "Noir",
      origin: "builtin",
      userId: null,
      visibility: "public",
    });
    await a.setSource({
      source: { kind: "set", label: null, setId: builtin },
      stageId: stageA.id,
    });
    expect(sourceCalls.at(-1)).toEqual({
      deckKey: "noir",
      kind: "set",
      label: "Noir",
      setId: builtin,
    });
  });
});
