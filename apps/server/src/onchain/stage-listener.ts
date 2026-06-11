import type { ControllableSession, SessionRegistry } from "@sonara/api/server";
import { bytes32ToRoom, clamp01, fromFixedPoint, knobFromIndex, monadTestnet, sonaraStageAbi } from '@sonara/onchain';
import type { StageKnob } from '@sonara/onchain';
import type { ClientScenePatch } from "@sonara/shared";
import { createPublicClient, webSocket } from 'viem';
import type { Address } from 'viem';

import type { Logger } from "../lib/logger";
import { PromptQueue } from "./prompt-queue";
import { publishActivity, publishBlock, publishQueue } from "./stage-feed";
import { stageRooms } from "./stage-rooms";
import { stageState } from "./stage-state";

// Coalesce knob events over this window into one applyPatch per room. Bounds
// generation/credit spend and matches the FLUX cadence; the 60fps shader still
// reacts to the scene.state broadcast immediately, so it feels instant anyway.
const FLUSH_MS = 200;

interface KnobAccum {
  // last-write-wins level in [0,1]
  absolutes: Map<StageKnob, number>;
  // summed relative steps
  deltas: Map<StageKnob, number>;
}

export interface StageListener {
  close: () => void;
}

// Subscribes to SonaraStage logs over WSS and folds on-chain intent into the
// live Sessions via the SAME ControllableSession methods the operator remote
// uses (applyPatch / prompt-driven trigger). Resolves room -> liveSessionId ->
// Session through stageRooms + the registry; unknown/closed rooms are skipped.
export const createStageListener = (opts: {
  registry: SessionRegistry;
  contract: Address;
  wssUrl: string;
  dwellMs: number;
  logger: Logger;
}): StageListener => {
  const { registry, contract, wssUrl, dwellMs, logger } = opts;
  const client = createPublicClient({
    chain: monadTestnet,
    transport: webSocket(wssUrl),
  });

  const accums = new Map<string, KnobAccum>();
  const queues = new Map<string, PromptQueue>();

  const resolve = (
    room: string
  ): { allowPrompts: boolean; session: ControllableSession } | null => {
    const binding = stageRooms.resolve(room);
    if (!binding) {
      return null;
    }
    // Stage-keyed bindings survive "new set" run swaps (the stage is the
    // durable target); legacy bindings still resolve by run id.
    let session: ControllableSession | undefined;
    if (binding.stageId) {
      session = registry.getByStageId(binding.stageId);
    } else if (binding.liveSessionId) {
      session = registry.getByLiveSessionId(binding.liveSessionId);
    }
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

  // Flush coalesced knob changes into one applyPatch per room, then advance any
  // prompt queues whose dwell has elapsed.
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
      const patch: Partial<Record<StageKnob, number>> = {};
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

  const onNudge = (room: string, knob: StageKnob, delta: number): void => {
    // delta is a signed fixed-point step (/1000) — convert to a [-1,1] increment.
    const accum = accumFor(room);
    accum.deltas.set(knob, (accum.deltas.get(knob) ?? 0) + delta / 1000);
  };

  const onSet = (room: string, knob: StageKnob, value: number): void => {
    const accum = accumFor(room);
    accum.absolutes.set(knob, fromFixedPoint(value));
    // an absolute set supersedes pending nudges
    accum.deltas.delete(knob);
  };

  // `paid` is the total USDC the contract pulled (base price + tip); `tip` is
  // the priority portion. The payment already happened on-chain by the time we
  // see the event, so an un-queueable prompt (room closed, prompts disabled)
  // is still counted as revenue — the room just doesn't play it.
  const onPrompt = (
    room: string,
    who: Address,
    text: string,
    paid: bigint,
    tip: bigint
  ): void => {
    stageState.addRevenue(room, paid);
    const resolved = resolve(room);
    if (!resolved?.allowPrompts) {
      return;
    }
    const q = queueFor(room);
    q.enqueue({ enqueuedAt: Date.now(), text, tip, who });
    const snapshot = q.snapshot();
    stageState.setQueue(room, snapshot);
    publishQueue(room, snapshot);
  };

  const onError = (error: unknown): void =>
    logger.warn({ error }, "stage listener subscription error");

  // One watcher per event so viem types each log's args precisely (a single
  // all-events watcher leaves every field optional). bump() the tx counter for
  // any room that saw activity, then handle the specific event.
  const base = { abi: sonaraStageAbi, address: contract, onError } as const;

  const unwatchNudge = client.watchContractEvent({
    ...base,
    eventName: "Nudge",
    onLogs: (logs) => {
      for (const log of logs) {
        const { args } = log;
        // viem types decoded args as optional; the contract guarantees them.
        if (
          args.room === undefined ||
          args.who === undefined ||
          args.knob === undefined ||
          args.delta === undefined
        ) {
          continue;
        }
        const room = bytes32ToRoom(args.room);
        stageState.bump(room);
        const knob = knobFromIndex(args.knob);
        if (knob) {
          onNudge(room, knob, args.delta);
          publishActivity(room, {
            blockNumber: Number(log.blockNumber ?? 0n),
            delta: args.delta / 1000,
            kind: "nudge",
            knob,
            txHash: log.transactionHash ?? "",
            who: args.who,
          });
        }
      }
    },
  });

  const unwatchSet = client.watchContractEvent({
    ...base,
    eventName: "Set",
    onLogs: (logs) => {
      for (const log of logs) {
        const { args } = log;
        if (
          args.room === undefined ||
          args.who === undefined ||
          args.knob === undefined ||
          args.value === undefined
        ) {
          continue;
        }
        const room = bytes32ToRoom(args.room);
        stageState.bump(room);
        const knob = knobFromIndex(args.knob);
        if (knob) {
          onSet(room, knob, args.value);
          publishActivity(room, {
            blockNumber: Number(log.blockNumber ?? 0n),
            kind: "set",
            knob,
            txHash: log.transactionHash ?? "",
            value: fromFixedPoint(args.value),
            who: args.who,
          });
        }
      }
    },
  });

  const unwatchPrompt = client.watchContractEvent({
    ...base,
    eventName: "Prompt",
    onLogs: (logs) => {
      for (const log of logs) {
        const { args } = log;
        if (
          args.room === undefined ||
          args.who === undefined ||
          args.text === undefined ||
          args.paid === undefined ||
          args.tip === undefined
        ) {
          continue;
        }
        const room = bytes32ToRoom(args.room);
        stageState.bump(room);
        // Fold the prompt in first so the activity's count frame carries the
        // updated revenue total.
        onPrompt(room, args.who, args.text, args.paid, args.tip);
        publishActivity(room, {
          blockNumber: Number(log.blockNumber ?? 0n),
          kind: "prompt",
          paid: args.paid,
          text: args.text,
          tip: args.tip,
          txHash: log.transactionHash ?? "",
          who: args.who,
        });
      }
    },
  });

  // Monad block heartbeat (~400ms) — rides the same WSS subscription
  // (eth_subscribe newHeads) and feeds the projector's block odometer.
  const unwatchBlocks = client.watchBlockNumber({
    emitOnBegin: true,
    onBlockNumber: publishBlock,
    onError,
  });

  const timer = setInterval(flush, FLUSH_MS);
  logger.info({ contract }, "stage listener started");

  return {
    close: () => {
      clearInterval(timer);
      unwatchNudge();
      unwatchSet();
      unwatchPrompt();
      unwatchBlocks();
      logger.info("stage listener stopped");
    },
  };
};
