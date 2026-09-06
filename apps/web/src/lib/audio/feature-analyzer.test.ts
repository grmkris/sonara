import { expect, test } from "bun:test";

import { FeatureAnalyzer } from "./feature-analyzer";
import { estimateBpm } from "./tempo";

test("fixed-rate tempo tracks 120 BPM independently of display sampling", () => {
  for (const fps of [30, 60, 120, 144]) {
    const flux = Array.from({ length: 8 * fps }, (_, i) =>
      i % Math.round(fps / 2) < 2 ? 1 : 0
    );
    expect(Math.abs(estimateBpm(flux, 120, fps) - 120)).toBeLessThanOrEqual(2);
  }
});
test("silence is finite and does not generate a beat", () => {
  const analyzer = new FeatureAnalyzer(48_000);
  const frame = analyzer.process(new Float32Array(2048), 1);
  expect(frame.features.rms).toBe(0);
  expect(frame.features.onset).toBe(false);
  expect(frame.confidence).toBe(0);
  expect(
    Object.values(frame.features)
      .filter((value) => typeof value === "number")
      .every(Number.isFinite)
  ).toBe(true);
});
test("low bass retains its broadband energy while DC is removed", () => {
  const samples = Float32Array.from(
    { length: 2048 },
    (_, i) => Math.sin((i * 2 * Math.PI * 60) / 48_000) * 0.5 + 0.2
  );
  const frame = new FeatureAnalyzer(48_000).process(samples, 1);
  expect(frame.features.rms).toBeGreaterThan(0.3);
  expect(
    new FeatureAnalyzer(48_000).process(new Float32Array(2048).fill(0.3), 1)
      .features.rms
  ).toBeLessThan(0.0001);
});

test("tempo survives occasional missing analysis windows", () => {
  const analyzer = new FeatureAnalyzer(48_000);
  let bpm = 0;
  for (let frame = 3; frame < 720; frame += 1) {
    // Two missing windows every ~0.7s: normal scheduler jitter under load.
    if (frame % 43 < 2) {
      continue;
    }
    const time = frame / 60;
    const samples = Float32Array.from({ length: 2048 }, (_, index) => {
      const t = Math.max(0, time - (2048 - index) / 48_000);
      return Math.sin(2 * Math.PI * 110 * t) * Math.exp(-(t % 0.5) * 25);
    });
    ({ bpm } = analyzer.process(samples, time).features);
  }
  expect(Math.abs(bpm - 120)).toBeLessThanOrEqual(3);
});
