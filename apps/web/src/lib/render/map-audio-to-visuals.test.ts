import { describe, expect, test } from "bun:test";
import type { AudioFeatures } from "@sonara/shared";
import { defaultAudio } from "@sonara/shared";

import { beatPulse } from "./map-audio-to-visuals";

const audio = (over: Partial<AudioFeatures>): AudioFeatures => ({
  ...defaultAudio,
  ...over,
});

describe("beatPulse", () => {
  test("is silent until tempo is locked (bpm === 0)", () => {
    // bpmPhase is pinned at 0 when unlocked; without the gate that would peg
    // the sawtooth at its max, so this guards the most bug-prone branch.
    expect(beatPulse(audio({ bpm: 0, bpmPhase: 0, rms: 1 }))).toBe(0);
  });

  test("peaks on the beat and decays before the next one", () => {
    const onBeat = beatPulse(audio({ bpm: 120, bpmPhase: 0, rms: 1 }));
    const midBeat = beatPulse(audio({ bpm: 120, bpmPhase: 0.5, rms: 1 }));
    expect(onBeat).toBeCloseTo(1, 5);
    expect(midBeat).toBeLessThan(onBeat);
    expect(midBeat).toBeGreaterThan(0);
  });

  test("energy-gates so quiet passages don't throb", () => {
    const loud = beatPulse(audio({ bpm: 120, bpmPhase: 0, rms: 1 }));
    const quiet = beatPulse(audio({ bpm: 120, bpmPhase: 0, rms: 0.1 }));
    expect(quiet).toBeLessThan(loud);
    expect(beatPulse(audio({ bpm: 120, bpmPhase: 0, rms: 0 }))).toBe(0);
  });
});
