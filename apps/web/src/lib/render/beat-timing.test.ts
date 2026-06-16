import { describe, expect, test } from "bun:test";

import { crossfadeMsToBeat } from "./beat-timing";

describe("crossfadeMsToBeat", () => {
  test("returns the base duration when unlocked (bpm 0)", () => {
    expect(crossfadeMsToBeat(0, 0.3, 1300)).toBe(1300);
  });

  test("snaps the end to a beat boundary at or past the base", () => {
    // 120 BPM → 500ms/beat. Start at phase 0 → beats land at 500,1000,1500…
    // First boundary ≥ 1300ms base is 1500ms.
    expect(crossfadeMsToBeat(120, 0, 1300)).toBeCloseTo(1500, 5);
  });

  test("accounts for the phase at crossfade start", () => {
    // phase 0.5 at 120 BPM → next beat in 250ms, then 750, 1250, 1750…
    // First boundary ≥ 1300 is 1750ms (but capped at maxMs = 1950 → kept).
    expect(crossfadeMsToBeat(120, 0.5, 1300)).toBeCloseTo(1750, 5);
  });

  test("clamps so slow tempos don't stretch absurdly", () => {
    // 40 BPM → 1500ms/beat. From phase 0, first boundary ≥ 1300 is 1500ms,
    // which is within maxMs (1950) — but a half-beat start would push to 2250,
    // clamped to maxMs.
    const out = crossfadeMsToBeat(40, 0.9, 1300);
    expect(out).toBeLessThanOrEqual(1300 * 1.5);
    expect(out).toBeGreaterThanOrEqual(1300 * 0.6);
  });

  test("stays within bounds across many tempos/phases", () => {
    for (let bpm = 60; bpm <= 180; bpm += 10) {
      for (let phase = 0; phase < 1; phase += 0.1) {
        const out = crossfadeMsToBeat(bpm, phase, 1300);
        expect(out).toBeGreaterThanOrEqual(1300 * 0.6 - 1e-6);
        expect(out).toBeLessThanOrEqual(1300 * 1.5 + 1e-6);
      }
    }
  });
});
