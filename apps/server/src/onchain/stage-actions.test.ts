/* oxlint-disable no-inline-comments -- inline expectation notes aid test readability */
import { afterEach, describe, expect, test } from "bun:test";

import type {
  ControllableSession,
  ControlSnapshot,
  SessionRegistry,
} from "@sonara/api/server";
import { defaultScene } from "@sonara/shared";
import type { ClientScenePatch } from "@sonara/shared";
import { typeIdGenerator } from "@sonara/shared/typeid";
import type { StageId } from "@sonara/shared/typeid";

import type { Logger } from "../lib/logger";
import { startStageActions } from "./stage-actions";
import type { StageActions } from "./stage-actions";
import { mintCode, stageRooms } from "./stage-rooms";

// Unit tests for the chain-free crowd intent fold (ex stage-listener): knob
// accumulation, set-supersedes-tap, clamping, and prompt gating. The 200ms
// flush interval is real — tests await one tick.

const noopLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
} as unknown as Logger;

const FLUSH_WAIT_MS = 250;
// oxlint-disable-next-line promise/avoid-new, no-promise-executor-return -- a plain sleep; Bun.sleep would also work but keeps the test runtime-agnostic
const flushed = () => Bun.sleep(FLUSH_WAIT_MS);

const makeFakeSession = (opts: {
  intensity?: number;
}): { session: ControllableSession; patches: ClientScenePatch[] } => {
  const patches: ClientScenePatch[] = [];
  const snapshot = {
    scene: { ...defaultScene, intensity: opts.intensity ?? 0.5 },
  } as ControlSnapshot;
  const session = {
    applyPatch: (patch: ClientScenePatch) => {
      patches.push(patch);
    },
    getControlSnapshot: () => snapshot,
  } as unknown as ControllableSession;
  return { patches, session };
};

const harness = (opts: { allowPrompts?: boolean; intensity?: number } = {}) => {
  const stageId = typeIdGenerator("stage") as StageId;
  const { session, patches } = makeFakeSession({ intensity: opts.intensity });
  const registry = {
    getByLiveSessionId: () => null,
    getByStageId: (id: string) => (id === stageId ? session : null),
    listByUserId: () => [],
    screenAttached: () => true,
  } as unknown as SessionRegistry;
  const room = mintCode();
  stageRooms.openForStage(room, stageId, opts.allowPrompts ?? true);
  const actions = startStageActions({
    dwellMs: 1000,
    logger: noopLogger,
    registry,
  });
  return { actions, patches, room, stageId };
};

let open: { actions: StageActions; room: string }[] = [];
afterEach(() => {
  for (const h of open) {
    h.actions.close();
    stageRooms.close(h.room);
  }
  open = [];
});

const make = (opts: Parameters<typeof harness>[0] = {}) => {
  const h = harness(opts);
  open.push(h);
  return h;
};

describe("stage actions", () => {
  test("taps accumulate within a flush window into one clamped patch", async () => {
    const h = make({ intensity: 0.5 });
    expect(h.actions.applyTap(h.room, "intensity", 0.12)).toBe(true);
    expect(h.actions.applyTap(h.room, "intensity", 0.12)).toBe(true);
    await flushed();
    expect(h.patches).toHaveLength(1);
    expect(h.patches[0]?.intensity).toBeCloseTo(0.74);
  });

  test("clamps to [0,1] at the edges", async () => {
    const h = make({ intensity: 0.95 });
    h.actions.applyTap(h.room, "intensity", 0.5);
    await flushed();
    expect(h.patches[0]?.intensity).toBe(1);
  });

  test("an absolute set supersedes pending taps on the same knob", async () => {
    const h = make({ intensity: 0.5 });
    h.actions.applyTap(h.room, "intensity", 0.3);
    h.actions.applySet(h.room, "intensity", 0.2);
    await flushed();
    expect(h.patches[0]?.intensity).toBeCloseTo(0.2);
  });

  test("taps after a set apply on top of the set level", async () => {
    const h = make({ intensity: 0.5 });
    h.actions.applySet(h.room, "intensity", 0.2);
    h.actions.applyTap(h.room, "intensity", 0.1);
    await flushed();
    expect(h.patches[0]?.intensity).toBeCloseTo(0.3);
  });

  test("unknown rooms are rejected without patching", async () => {
    const h = make();
    expect(h.actions.applyTap("ZZZZZ", "intensity", 0.1)).toBe(false);
    expect(h.actions.enqueuePrompt("ZZZZZ", "hello", "K7QX")).toBe(false);
    await flushed();
    expect(h.patches).toHaveLength(0);
  });

  test("prompts respect the allowPrompts gate and play via applyPatch", () => {
    const closed = make({ allowPrompts: false });
    expect(closed.actions.enqueuePrompt(closed.room, "nope", "K7QX")).toBe(
      false
    );

    const openRoom = make({ allowPrompts: true });
    expect(
      openRoom.actions.enqueuePrompt(openRoom.room, "neon koi", "K7QX")
    ).toBe(true);
    // first prompt plays immediately (queue advance on enqueue)
    expect(openRoom.patches.at(-1)?.prompt).toBe("neon koi");
  });
});
