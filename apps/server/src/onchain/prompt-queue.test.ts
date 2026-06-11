/* oxlint-disable no-inline-comments -- inline expectation notes aid test readability */
import { describe, expect, test } from "bun:test";

import { PromptQueue } from "./prompt-queue";

// A controllable clock + a play-log harness.
const harness = (dwellMs = 1000, maxLen = 20) => {
  let t = 0;
  const played: string[] = [];
  const dropped: string[] = [];
  const q = new PromptQueue({
    dwellMs,
    maxLen,
    now: () => t,
    onDrop: (e) => dropped.push(e.text),
    onPlay: (e) => played.push(e.text),
  });
  const enq = (text: string, who = text, tip = 0n) =>
    q.enqueue({ enqueuedAt: t, text, tip, who });
  const advance = (ms: number) => {
    t += ms;
  };
  return { advance, dropped, enq, played, q, tick: () => q.tick() };
};

describe("PromptQueue", () => {
  test("first prompt plays immediately; others wait their dwell turn", () => {
    const h = harness(1000);
    h.enq("a");
    h.enq("b");
    h.enq("c");
    expect(h.played).toEqual(["a"]); // only a is playing
    h.tick();
    expect(h.played).toEqual(["a"]); // dwell not elapsed
    h.advance(1000);
    h.tick();
    expect(h.played).toEqual(["a", "b"]);
    h.advance(1000);
    h.tick();
    expect(h.played).toEqual(["a", "b", "c"]);
  });

  test("a tip jumps ahead of free prompts already queued", () => {
    const h = harness(1000);
    h.enq("free1");
    h.enq("free2"); // queued behind nothing-playing rules: free1 plays, free2 queued
    h.enq("paid", "whale", 1000n); // should jump to front of the queue
    expect(h.played).toEqual(["free1"]);
    h.advance(1000);
    h.tick();
    expect(h.played).toEqual(["free1", "paid"]);
  });

  test("dedup rejects identical text; per-sender re-submit replaces", () => {
    const h = harness(1000);
    expect(h.enq("a", "alice")).toBe(true); // plays
    expect(h.enq("a", "bob")).toBe(false); // dup text rejected
    h.enq("x", "carol");
    expect(h.enq("y", "carol")).toBe(true); // carol replaces her own queued x
    h.advance(1000);
    h.tick();
    expect(h.played).toEqual(["a", "y"]); // carol's x was replaced by y
  });

  test("empty queue: current prompt sticks, next enqueue plays at once", () => {
    const h = harness(1000);
    h.enq("a");
    h.advance(5000); // long idle past dwell, nothing queued
    h.tick();
    expect(h.played).toEqual(["a"]); // a still showing
    h.enq("b"); // dwell already served -> plays immediately
    expect(h.played).toEqual(["a", "b"]);
  });

  test("overflow drops lowest-priority tail, not silently", () => {
    const h = harness(1000, 3);
    h.enq("playing");
    for (const t of ["q1", "q2", "q3", "q4", "q5"]) {
      h.enq(t);
    }
    expect(h.dropped.length).toBeGreaterThan(0);
  });

  test("empty/whitespace prompts are rejected", () => {
    const h = harness();
    expect(h.enq("   ")).toBe(false);
    expect(h.played).toEqual([]);
  });
});
