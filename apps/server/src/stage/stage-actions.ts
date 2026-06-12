import type { ControllableSession, SessionRegistry } from "@sonara/api/server";
import type { ClientScenePatch, StageKnobName } from "@sonara/shared";

import type { Logger } from "../lib/logger";
import { PromptQueue } from "./prompt-queue";
import { publishQueue } from "./stage-feed";
import { stageRooms } from "./stage-rooms";
import { stageState } from "./stage-state";

// Coalesce knob actions over this window into one applyPatch per room. Bounds
// generation/credit spend and matches the FLUX cadence; the 60fps shader still
// reacts to the scene.state broadcast immediately, so it feels instant anyway.
const FLUSH_MS = 200;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

interface KnobAccum {
  // last-write-wins level in [0,1]
  absolutes: Map<StageKnobName, number>;
  // summed relative steps
  deltas: Map<StageKnobName, number>;
}

export interface StageActions {
  // Relative knob tap; delta is a normalized signed step in [-1, 1].
  // Returns false when the room isn't live.
  applyTap(room: string, knob: StageKnobName, delta: number): boolean;
  // Absolute knob write; level in [0, 1]. Supersedes pending taps.
  applySet(room: string, knob: StageKnobName, level: number): boolean;
  // Queue a crowd prompt (dwell-rotated; generation debits the stage owner's
  // credits when it plays). Returns false when rejected (room not live,
  // empty/duplicate text).
  enqueuePrompt(room: string, text: string, from: string): boolean;
  close(): void;
}

// Folds crowd intent (stage.tap / stage.setKnob / stage.submitPrompt RPCs)
// into the live Sessions via the SAME ControllableSession methods the
// operator remote uses (applyPatch / prompt-driven trigger). Resolves room →
// stage/run → Session through stageRooms + the registry; unknown/closed rooms
// are skipped. Successor of the Monad event listener — identical accumulator
// and dwell-queue semantics, minus the chain transport.
export const startStageActions = (opts: {
  registry: SessionRegistry;
  dwellMs: number;
  logger: Logger;
}): StageActions => {
  const { registry, dwellMs, logger } = opts;

  const accums = new Map<string, KnobAccum>();
  const queues = new Map<string, PromptQueue>();

  const resolve = (
    room: string
  ): { allowPrompts: boolean; session: ControllableSession } | null => {
    const binding = stageRooms.resolve(room);
    if (!binding) {
      return null;
    }
    // Stage-keyed bindings survive "new set" run swaps — the stage is the
    // durable target.
    const session = registry.getByStageId(binding.stageId);
    if (!session) {
      return null;
    }
    return { allowPrompts: binding.allowPrompts, session };
  };

  const accumFor = (room: string): KnobAccum => {
    let a = accums.get(room);
    if (!a) {
      a = { absolutes: new Map(), deltas: new Map() };
      accums.set(room, a);
    }
    return a;
  };

  const queueFor = (room: string): PromptQueue => {
    let q = queues.get(room);
    if (!q) {
      const queue = new PromptQueue({
        dwellMs,
        now: () => Date.now(),
        onDrop: (e, reason) =>
          logger.info({ reason, text: e.text }, "stage prompt dropped"),
        onPlay: (entry) => {
          resolve(room)?.session.applyPatch({ prompt: entry.text }, "client");
          const snapshot = queue.snapshot();
          stageState.setQueue(room, snapshot);
          publishQueue(room, snapshot);
        },
      });
      queues.set(room, queue);
      q = queue;
    }
    return q;
  };

  // Flush coalesced knob changes into one applyPatch per room, then advance
  // any prompt queues whose dwell has elapsed.
  const flush = (): void => {
    for (const [room, accum] of accums) {
      if (accum.absolutes.size === 0 && accum.deltas.size === 0) {
        continue;
      }
      const resolved = resolve(room);
      if (!resolved) {
        accums.delete(room);
        continue;
      }
      const { scene } = resolved.session.getControlSnapshot();
      const patch: Partial<Record<StageKnobName, number>> = {};
      for (const [knob, value] of accum.absolutes) {
        patch[knob] = clamp01(value);
      }
      for (const [knob, delta] of accum.deltas) {
        const base = patch[knob] ?? scene[knob];
        patch[knob] = clamp01(base + delta);
      }
      resolved.session.applyPatch(patch as ClientScenePatch, "client");
      accums.delete(room);
    }
    for (const q of queues.values()) {
      q.tick();
    }
  };

  const timer = setInterval(flush, FLUSH_MS);
  logger.info({}, "stage actions started");

  return {
    applySet: (room, knob, level) => {
      if (!resolve(room)) {
        return false;
      }
      const accum = accumFor(room);
      accum.absolutes.set(knob, clamp01(level));
      // an absolute set supersedes pending taps
      accum.deltas.delete(knob);
      return true;
    },
    applyTap: (room, knob, delta) => {
      if (!resolve(room)) {
        return false;
      }
      const accum = accumFor(room);
      accum.deltas.set(knob, (accum.deltas.get(knob) ?? 0) + delta);
      return true;
    },
    close: () => {
      clearInterval(timer);
      logger.info("stage actions stopped");
    },
    enqueuePrompt: (room, text, from) => {
      const resolved = resolve(room);
      if (!resolved?.allowPrompts) {
        return false;
      }
      const q = queueFor(room);
      const queued = q.enqueue({
        enqueuedAt: Date.now(),
        text,
        who: from,
      });
      if (queued) {
        const snapshot = q.snapshot();
        stageState.setQueue(room, snapshot);
        publishQueue(room, snapshot);
      }
      return queued;
    },
  };
};

// Boot-time singleton, mirroring bindStagePublisher: server.ts constructs the
// actions once and binds them here so the stage router can reach them without
// threading through the oRPC context.
let actions: StageActions | null = null;
export const bindStageActions = (a: StageActions): void => {
  actions = a;
};
export const stageActions = (): StageActions | null => actions;
