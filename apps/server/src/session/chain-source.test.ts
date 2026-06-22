import { describe, expect, test } from "bun:test";

import { chooseChainSource, freshCadenceFromStability } from "./session";

// The chain-or-fresh decision (chooseChainSource) is the single lever behind
// "a typed prompt should land decisively, not crawl in". These cover the new
// forceFresh hard-cut alongside the existing edit-endpoint / seed / stability
// gates. The reseed + arming live in trigger() (credit + fal path) and are
// exercised by the wider integration suite + manual dev verification.

const EDIT = "fal-ai/flux-2/klein/9b/edit";
const PREV = "https://fal.media/prev.jpg";

const base = {
  chainUrl: PREV as string | null,
  editFalId: EDIT as string | undefined,
  forceFresh: false,
  framesSinceFresh: 0,
  seeded: false,
  stability: 1,
};

describe("chooseChainSource", () => {
  test("forceFresh hard-cuts to a fresh t2i even mid-chain", () => {
    // stability 1 + framesSinceFresh 0 would normally chain — forceFresh wins.
    expect(chooseChainSource({ ...base, forceFresh: true })).toBeNull();
  });

  test("chains off the previous frame while within the stability budget", () => {
    expect(freshCadenceFromStability(1)).toBe(24);
    expect(chooseChainSource({ ...base, framesSinceFresh: 5 })).toBe(PREV);
  });

  test("goes fresh once the stability I-frame budget is spent", () => {
    // stability 0 → cadence 0 → never chains on budget alone.
    expect(chooseChainSource({ ...base, stability: 0 })).toBeNull();
    // budget exhausted at higher stability.
    expect(
      chooseChainSource({ ...base, framesSinceFresh: 24, stability: 1 })
    ).toBeNull();
  });

  test("a just-consumed seed chains even at stability 0", () => {
    // An explicit goLive/upload anchor must visibly take regardless of budget.
    expect(chooseChainSource({ ...base, seeded: true, stability: 0 })).toBe(
      PREV
    );
  });

  test("no edit endpoint or no prior frame → fresh", () => {
    expect(chooseChainSource({ ...base, editFalId: undefined })).toBeNull();
    expect(chooseChainSource({ ...base, chainUrl: null })).toBeNull();
  });
});
