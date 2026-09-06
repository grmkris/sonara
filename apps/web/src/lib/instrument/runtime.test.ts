import { defaultAudio } from "@sonara/shared";
import { expect, spyOn, test } from "bun:test";

import { InstrumentRuntime } from "./runtime";

test("fresh input survives a slow render frame while stale audio expires", () => {
  // No graphics context is initialized: only the simulation clock and inputs run.
  const runtime = new InstrumentRuntime({
    height: 1,
    width: 1,
  } as HTMLCanvasElement);
  const render = spyOn(runtime.renderer, "step").mockImplementation(() => {});
  const audio = {
    confidence: 0.9,
    features: { ...defaultAudio, bpm: 120, rms: 0.5 },
    time: 1,
  };
  try {
    runtime.advance(0);
    runtime.setAudio(audio);
    runtime.setControls({
      attractors: [{ force: 1, x: 0.5, y: 0.5 }],
      expansion: 0.5,
      rotation: 0,
      time: 1,
    });
    runtime.advance(1);
    expect(runtime.transport.bpm).toBe(120);
    expect(runtime.audio.features.rms).toBe(0.5);
    expect(runtime.controls.attractors[0]?.force).toBeGreaterThan(0.5);

    // Reading an unchanged engine snapshot must not extend its lifetime.
    runtime.setAudio(audio);
    runtime.advance(2);
    expect(runtime.transport.bpm).toBe(0);
    expect(runtime.controls.attractors[0]?.force).toBeLessThan(0.25);

    runtime.setAudio({ ...audio, time: 3 });
    runtime.advance(3);
    expect(runtime.transport.bpm).toBe(120);
  } finally {
    render.mockRestore();
  }
});
