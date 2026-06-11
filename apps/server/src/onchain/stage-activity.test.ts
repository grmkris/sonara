/* oxlint-disable no-inline-comments -- inline expectation notes aid test readability */
import { describe, expect, test } from "bun:test";

import { deriveAgentAddress, StageActivityLog } from "./stage-activity";

// anvil's well-known dev key #0 — fine to hard-code in a unit test.
const AGENT_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const AGENT_ADDRESS = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";

// A controllable clock + a recorder with a tiny capacity for eviction tests.
const harness = (opts: { agentAddress?: string | null; capacity?: number } = {}) => {
  let t = 1000;
  const log = new StageActivityLog({ now: () => t, ...opts });
  const nudge = (room: string, who = "0xAAA") =>
    log.record(room, {
      blockNumber: 7,
      delta: 0.12,
      kind: "nudge",
      knob: "softness",
      txHash: "0xhash",
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

  test("tags the agent address case-insensitively", () => {
    const h = harness({ agentAddress: AGENT_ADDRESS });
    expect(h.nudge("AAAAA", AGENT_ADDRESS.toUpperCase().replace("0X", "0x")).agent).toBe(true);
    expect(h.nudge("AAAAA", "0xsomeoneelse").agent).toBe(false);
  });

  test("never tags when no agent address is configured", () => {
    const h = harness({ agentAddress: null });
    expect(h.nudge("AAAAA").agent).toBe(false);
  });

  test("stringifies money fields and caps prompt text", () => {
    const h = harness();
    const e = h.log.record("AAAAA", {
      blockNumber: 9,
      kind: "prompt",
      paid: 1_500_000n,
      text: "x".repeat(300),
      tip: 500_000n,
      txHash: "0xhash",
      who: "0xAAA",
    });
    expect(e.paid).toBe("1500000");
    expect(e.tip).toBe("500000");
    expect(e.text).toHaveLength(200);
    expect(JSON.stringify(e)).toContain('"tip":"500000"'); // no bigint leaks
  });

  test("clear() drops the room and resets its seq", () => {
    const h = harness();
    h.nudge("AAAAA");
    h.log.clear("AAAAA");
    expect(h.log.recent("AAAAA")).toEqual([]);
    expect(h.nudge("AAAAA").seq).toBe(1);
  });
});

describe("deriveAgentAddress", () => {
  test("derives the lowercase EOA address from a valid key", () => {
    expect(deriveAgentAddress(AGENT_KEY)).toBe(AGENT_ADDRESS);
  });

  test("returns null for empty or malformed keys", () => {
    expect(deriveAgentAddress("")).toBeNull();
    expect(deriveAgentAddress("0x123")).toBeNull();
    expect(deriveAgentAddress("not-a-key")).toBeNull();
  });
});
