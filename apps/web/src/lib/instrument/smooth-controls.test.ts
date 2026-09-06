import { expect, test } from "bun:test";

import type { PerformanceControlFrame } from "@sonara/shared";

import { smoothControls } from "./smooth-controls";

const empty: PerformanceControlFrame = {
  attractors: [],
  expansion: 0.5,
  rotation: 0,
  time: 0,
};
const target: PerformanceControlFrame = {
  attractors: [{ force: 1, id: 0, x: 0.75, y: 0.3 }],
  expansion: 0.8,
  rotation: 0,
  time: 0,
};
test("tracking response uses elapsed time rather than display frame count", () => {
  const run = (fps: number) => {
    let value = empty;
    for (let i = 1; i <= fps; i += 1) {
      value = smoothControls(value, target, 1 / fps, 0, i / fps);
    }
    return value;
  };
  expect(run(30).attractors[0]?.force).toBeCloseTo(
    run(120).attractors[0]?.force ?? 0,
    6
  );
  expect(run(30).expansion).toBeCloseTo(run(120).expansion, 6);
});
test("a short dropout holds position, then releases without snapping", () => {
  const held = smoothControls(target, target, 0.016, 0.2, 1);
  expect(held.attractors[0]?.force).toBe(1);
  const fading = smoothControls(held, target, 0.016, 0.5, 1.016);
  expect(fading.attractors[0]?.force).toBeGreaterThan(0.8);
  expect(fading.attractors[0]?.force).toBeLessThan(1);
  let ended = fading;
  for (let i = 0; i < 120; i += 1) {
    ended = smoothControls(ended, target, 1 / 60, 1, 2);
  }
  expect(ended.attractors).toEqual([]);
  expect(ended.expansion).toBeCloseTo(0.5);
});
test("rotation crosses the angle boundary by the short route", () => {
  const next = {
    ...target,
    attractors: [...target.attractors, { force: 1, id: 1, x: 0.2, y: 0.4 }],
    rotation: -3.1,
  };
  const value = smoothControls({ ...next, rotation: 3.1 }, next, 0.016, 0, 1);
  expect(Math.abs(value.rotation)).toBeGreaterThan(3);
});
