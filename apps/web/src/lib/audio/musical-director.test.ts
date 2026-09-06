import { expect, test } from "bun:test";

import { defaultAudio } from "@sonara/shared";
import type { AudioFeatureFrame } from "@sonara/shared";

import { MusicalDirector } from "./musical-director";

const frame = (
  time: number,
  overrides: Partial<AudioFeatureFrame["features"]> = {}
): AudioFeatureFrame => ({
  confidence: 0.8,
  features: {
    ...defaultAudio,
    bass: 0.7,
    mids: 0.5,
    rms: 0.3,
    treble: 0.3,
    ...overrides,
  },
  time,
});
test("onsets remain visible across dropped presentation frames and decay without another kick", () => {
  const director = new MusicalDirector();
  director.process(frame(0.01));
  expect(
    director.process(frame(0.02, { onset: true, onsetType: "kick" })).pulse
  ).toBe(1);
  let output = director.process(frame(0.03));
  for (let i = 4; i <= 12; i += 1) {
    output = director.process(frame(i / 100));
  }
  expect(output.pulse).toBeGreaterThan(0.5);
  expect(output.pulse).toBeLessThan(1);
  for (let i = 13; i <= 100; i += 1) {
    output = director.process(frame(i / 100));
  }
  expect(output.pulse).toBeLessThan(0.02);
});
test("silence is spacious and cannot invent rhythmic hits; source resets clear the previous song", () => {
  const director = new MusicalDirector();
  director.process(frame(1, { onset: true, onsetType: "kick" }));
  const silent = { ...defaultAudio, onset: true };
  const result = director.process({ confidence: 0, features: silent, time: 5 });
  expect(result.pulse).toBe(0);
  expect(result.phase).toBe(0);
  expect(result.space).toBe(1);
  expect(result.weight).toBe(0);
  expect(result.release).toBe(0);
});
test("a sustained build followed by a drop opens the material once, without rapid retriggering", () => {
  const director = new MusicalDirector();
  let peak = 0;
  let releases = 0;
  let previous = 0;
  for (let i = 0; i < 2000; i += 1) {
    const rms = i < 900 ? 0.3 : 0.015;
    const output = director.process(frame(i / 100, { rms }));
    peak = Math.max(peak, output.tension);
    if (output.release > previous) {
      releases += 1;
    }
    previous = output.release;
  }
  expect(peak).toBeGreaterThan(0.35);
  expect(releases).toBe(1);
});
