import { MAX_STAGE_PROMPT_CHARS } from "@sonara/shared";
import type { StageActivityEvent, StageKnobName } from "@sonara/shared";

// Per-room ring buffer of crowd stage actions — the data behind the live
// "wire" feed (activity ticker / latency chip). stage-actions records every
// tap/set/prompt here; /ws/stage subscribers get the backlog in their hello
// frame and live pushes afterwards.
//
// Pure logic with an injected clock (same rationale as PromptQueue), so bare
// `bun test` runs it without a configured environment.

// What the RPCs supply per action; seq / serverTs are assigned at record time.
export interface StageActivityInput {
  delta?: number;
  kind: "nudge" | "set" | "prompt";
  knob?: StageKnobName;
  text?: string;
  value?: number;
  who: string;
}

export class StageActivityLog {
  private readonly byRoom = new Map<
    string,
    { nextSeq: number; ring: StageActivityEvent[] }
  >();

  private readonly capacity: number;
  private readonly now: () => number;

  constructor(opts: { capacity?: number; now?: () => number }) {
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
      kind: input.kind,
      seq: entry.nextSeq,
      serverTs: this.now(),
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
      event.text = input.text.slice(0, MAX_STAGE_PROMPT_CHARS);
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
