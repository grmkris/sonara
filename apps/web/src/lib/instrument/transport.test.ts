import { expect, test } from "bun:test";

import { Transport } from "./transport";

test("fixed simulation count is independent of refresh rate", () => {
  for (const fps of [30, 60, 120, 144]) {
    const transport = new Transport();
    let steps = 0;
    const tick = () => {
      steps += 1;
    };
    for (let i = 0; i <= fps * 10; i += 1) {
      transport.advance(i / fps, 120, tick);
    }
    expect(steps).toBe(600);
    expect(transport.time).toBeCloseTo(10, 6);
  }
});
test("freeze and long tab suspension do not accumulate runaway work", () => {
  const transport = new Transport();
  let steps = 0;
  const tick = () => {
    steps += 1;
  };
  transport.advance(0, 120, tick);
  transport.frozen = true;
  transport.advance(60, 120, tick);
  expect(steps).toBe(0);
  transport.frozen = false;
  transport.advance(120, 120, tick);
  expect(steps).toBe(6);
});
test("tap tempo and half-time are explicit overrides", () => {
  const transport = new Transport();
  transport.tap(0);
  transport.tap(0.5);
  transport.tap(1);
  transport.multiply(0.5);
  transport.advance(1, 90, () => {});
  expect(transport.bpm).toBe(60);
  transport.automatic();
  transport.advance(2, 90, () => {});
  expect(transport.bpm).toBe(90);
});
