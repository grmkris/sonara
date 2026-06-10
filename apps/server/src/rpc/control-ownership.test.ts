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
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";

import { controlRouter } from "./control.router";
import type { ServerHttpContext } from "./procedures";

// resolveOwnedSession semantics, exercised through the router: unknown id →
// NOT_FOUND, someone else's live session → FORBIDDEN, own session → the call
// reaches the Session. No rows involved — the registry stub IS the world; the
// ctx still carries the harness db because the context shape requires one.

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
  listByUserId: (rawUserId) =>
    [...sessions.values()].filter((s) => s.userId === rawUserId),
};

// Fake Session that records applyPatch calls so "own session succeeds" can
// assert the mutation actually landed, not just that no error was thrown.
const registerSession = (
  ownerId: UserId
): { calls: PatchCall[]; liveSessionId: LiveSessionId } => {
  const liveSessionId = typeIdGenerator("liveSession") as LiveSessionId;
  const calls: PatchCall[] = [];
  const snapshot: ControlSnapshot = {
    currentFrameUrl: null,
    currentSource: null,
    demoDeck: null,
    demoMode: false,
    imageAnchor: null,
    jobStatus: "idle",
    lastFrameUrl: null,
    liveSessionId,
    nowPlaying: null,
    scene: defaultScene,
    startedAt: Date.now(),
  };
  sessions.set(liveSessionId, {
    applyPatch: (patch, origin) => {
      calls.push({ origin, patch });
    },
    getControlSnapshot: () => snapshot,
    goLive: () => {},
    liveSessionId,
    notifyStage: () => {},
    reset: () => {},
    setCurrentFrame: () => {},
    setCurrentSource: () => {},
    setDemoMode: () => {},
    setImageAnchor: () => {},
    userId: typeIdToUuid(ownerId).uuid,
  });
  return { calls, liveSessionId };
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

beforeAll(async () => {
  ({ db } = await getTestDb());
  a = makeClient(userA);
  b = makeClient(userB);
}, 30_000);

beforeEach(() => {
  sessions.clear();
});

describe("resolveOwnedSession via the control router", () => {
  test("unknown liveSessionId → NOT_FOUND", async () => {
    const code = await errorCodeOf(
      a.snapshot({ liveSessionId: typeIdGenerator("liveSession") })
    );
    expect(code).toBe("NOT_FOUND");
  });

  test("someone else's live session → FORBIDDEN", async () => {
    const { liveSessionId } = registerSession(userA);
    const code = await errorCodeOf(
      b.scenePatch({ liveSessionId, patch: { prompt: "mine now" } })
    );
    expect(code).toBe("FORBIDDEN");
  });

  test("anonymous caller → UNAUTHORIZED before any lookup", async () => {
    const { liveSessionId } = registerSession(userA);
    const code = await errorCodeOf(makeClient(null).snapshot({ liveSessionId }));
    expect(code).toBe("UNAUTHORIZED");
  });

  test("own session: scenePatch reaches the Session as a client patch", async () => {
    const { calls, liveSessionId } = registerSession(userA);
    await a.scenePatch({ liveSessionId, patch: { prompt: "neon koi" } });
    expect(calls).toEqual([
      { origin: "client", patch: { prompt: "neon koi" } },
    ]);
  });

  test("own session: snapshot returns the Session's control snapshot", async () => {
    const { liveSessionId } = registerSession(userA);
    const snap = await a.snapshot({ liveSessionId });
    expect(snap.liveSessionId).toBe(liveSessionId);
    expect(snap.jobStatus).toBe("idle");
  });
});
