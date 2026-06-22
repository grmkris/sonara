import { describe, expect, test } from "bun:test";

import type { BeatFireInput } from "./beat-clock";
import { shouldFireForBeat } from "./beat-clock";

const base: BeatFireInput = {
  bpm: 120,
  bpmPhase: 0,
  bpmPhaseAt: 0,
  genLatencyMs: 250,
  lastKeyframeAt: 0,
  now: 0,
  periodicMs: 4000,
};

describe("shouldFireForBeat", () => {
  test("never fires before the cadence floor", () => {
    // Only 1s since the last keyframe, floor is 4s.
    expect(shouldFireForBeat({ ...base, now: 1000 })).toBe(false);
  });

  test("falls back to the wall-clock gate when tempo is unlocked", () => {
    // bpm 0 → fire as soon as the floor passes, like the old behavior.
    expect(shouldFireForBeat({ ...base, bpm: 0, now: 4000 })).toBe(true);
  });

  test("falls back when the phase sample is stale", () => {
    // Floor passed, but the last phase sample is 3s old (> 1.5s default).
    expect(shouldFireForBeat({ ...base, bpmPhaseAt: 1000, now: 4000 })).toBe(
      true
    );
  });

  test("holds past the floor until just before the next downbeat", () => {
    // Fresh phase sample (phaseAt = now, as the 5Hz uplink keeps it). 120 BPM
    // → 500ms/beat. phase 0.2 → msToBeat 400ms > 250ms latency → hold.
    expect(
      shouldFireForBeat({ ...base, bpmPhase: 0.2, bpmPhaseAt: 4000, now: 4000 })
    ).toBe(false);
    // phase 0.6 → msToBeat 200ms ≤ latency → fire on this beat.
    expect(
      shouldFireForBeat({ ...base, bpmPhase: 0.6, bpmPhaseAt: 4000, now: 4000 })
    ).toBe(true);
  });

  test("failsafe: never delays more than one beat past the floor", () => {
    // Construct a phase that would otherwise keep saying 'wait' right at the
    // one-beat-past-floor boundary; the failsafe forces a fire.
    expect(
      shouldFireForBeat({
        ...base,
        bpmPhase: 0.01,
        bpmPhaseAt: 4500,
        now: 4500,
      })
    ).toBe(true);
  });

  test("fires immediately past the floor when latency exceeds a beat", () => {
    // 200 BPM → 300ms/beat, latency 400ms > beat → can't pre-empt, fire now.
    expect(
      shouldFireForBeat({
        ...base,
        bpm: 200,
        bpmPhaseAt: 4000,
        genLatencyMs: 400,
        now: 4000,
      })
    ).toBe(true);
  });
});
