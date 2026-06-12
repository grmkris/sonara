/* oxlint-disable no-inline-comments -- inline expectation notes aid test readability */
import { describe, expect, test } from "bun:test";

import { StageActivityLog } from "./stage-activity";

// A controllable clock + a recorder with a tiny capacity for eviction tests.
const harness = (opts: { capacity?: number } = {}) => {
  let t = 1000;
  const log = new StageActivityLog({ now: () => t, ...opts });
  const nudge = (room: string, who = "K7QX") =>
    log.record(room, {
      delta: 0.12,
      kind: "nudge",
      knob: "softness",
      who,
    });
  const advance = (ms: number) => {
    t += ms;
  };
  return { advance, log, nudge };
};

describe("StageActivityLog", () => {
  test("assigns a per-room monotonic seq starting at 1", () => {
    const h = harness();
    expect(h.nudge("AAAAA").seq).toBe(1);
    expect(h.nudge("AAAAA").seq).toBe(2);
    expect(h.nudge("BBBBB").seq).toBe(1); // rooms are independent
    expect(h.nudge("AAAAA").seq).toBe(3);
  });

  test("stamps serverTs from the injected clock", () => {
    const h = harness();
    expect(h.nudge("AAAAA").serverTs).toBe(1000);
    h.advance(400);
    expect(h.nudge("AAAAA").serverTs).toBe(1400);
  });

  test("evicts oldest beyond capacity but seq keeps counting", () => {
    const h = harness({ capacity: 3 });
    for (let i = 0; i < 5; i += 1) {
      h.nudge("AAAAA");
    }
    const recent = h.log.recent("AAAAA");
    expect(recent.map((e) => e.seq)).toEqual([3, 4, 5]); // oldest → newest
  });

  test("recent() is a copy and empty for unknown rooms", () => {
    const h = harness();
    h.nudge("AAAAA");
    const copy = h.log.recent("AAAAA");
    copy.pop();
    expect(h.log.recent("AAAAA")).toHaveLength(1);
    expect(h.log.recent("ZZZZZ")).toEqual([]);
  });

  test("caps prompt text", () => {
    const h = harness();
    const e = h.log.record("AAAAA", {
      kind: "prompt",
      text: "x".repeat(300),
      who: "K7QX",
    });
    expect(e.text).toHaveLength(200);
  });

  test("clear() drops the room and resets its seq", () => {
    const h = harness();
    h.nudge("AAAAA");
    h.log.clear("AAAAA");
    expect(h.log.recent("AAAAA")).toEqual([]);
    expect(h.nudge("AAAAA").seq).toBe(1);
  });
});
