import type { StageActivityEvent, StageKnobName } from "@sonara/shared";
import { privateKeyToAccount } from "viem/accounts";

// Per-room ring buffer of decoded on-chain stage actions — the data behind
// the live "wire" feed (tx ticker / latency chip / agent tagging). The
// listener records every Nudge/Set/Prompt log here; /ws/stage subscribers get
// the backlog in their hello frame and live pushes afterwards.
//
// Pure logic with an injected clock (same rationale as PromptQueue) and no
// env import, so bare `bun test` runs it without a configured environment.
// The singleton lives in stage-feed.ts, which owns the env coupling.

// Returns the EOA address for the MCP agent key, or null when unset/invalid —
// used to tag the agent's txs in the feed (an AI VJ, not a phone).
export const deriveAgentAddress = (key: string): string | null =>
  /^0x[0-9a-fA-F]{64}$/u.test(key)
    ? privateKeyToAccount(key as `0x${string}`).address.toLowerCase()
    : null;

// What the listener supplies per log; seq / serverTs / agent are assigned at
// record time. Money fields arrive as bigints straight off the log and are
// stringified here — bigints must never reach JSON.stringify.
export interface StageActivityInput {
  blockNumber: number;
  delta?: number;
  kind: "nudge" | "set" | "prompt";
  knob?: StageKnobName;
  paid?: bigint;
  text?: string;
  tip?: bigint;
  txHash: string;
  value?: number;
  who: string;
}

const MAX_TEXT_LEN = 200;

export class StageActivityLog {
  private readonly byRoom = new Map<
    string,
    { nextSeq: number; ring: StageActivityEvent[] }
  >();

  private readonly agentAddress: string | null;
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(opts: {
    agentAddress?: string | null;
    capacity?: number;
    now?: () => number;
  }) {
    this.agentAddress = opts.agentAddress ?? null;
    this.capacity = opts.capacity ?? 64;
    this.now = opts.now ?? Date.now;
  }

  record(room: string, input: StageActivityInput): StageActivityEvent {
    let entry = this.byRoom.get(room);
    if (!entry) {
      entry = { nextSeq: 1, ring: [] };
      this.byRoom.set(room, entry);
    }
    const event: StageActivityEvent = {
      agent: input.who.toLowerCase() === this.agentAddress,
      blockNumber: input.blockNumber,
      kind: input.kind,
      seq: entry.nextSeq,
      serverTs: this.now(),
      txHash: input.txHash,
      who: input.who,
    };
    if (input.knob !== undefined) {
      event.knob = input.knob;
    }
    if (input.delta !== undefined) {
      event.delta = input.delta;
    }
    if (input.value !== undefined) {
      event.value = input.value;
    }
    if (input.text !== undefined) {
      event.text = input.text.slice(0, MAX_TEXT_LEN);
    }
    if (input.paid !== undefined) {
      event.paid = input.paid.toString();
    }
    if (input.tip !== undefined) {
      event.tip = input.tip.toString();
    }
    entry.nextSeq += 1;
    entry.ring.push(event);
    while (entry.ring.length > this.capacity) {
      entry.ring.shift();
    }
    return event;
  }

  // Oldest → newest copy, for the hello backlog.
  recent(room: string): StageActivityEvent[] {
    return [...(this.byRoom.get(room)?.ring ?? [])];
  }

  clear(room: string): void {
    this.byRoom.delete(room);
  }
}
