import { expect, test } from "bun:test";

import { handControls, poseControls } from "./vision-controls";

test("pinch is relative to palm size", () => {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[9] = { x: 0.5, y: 0.3, z: 0 };
  hand[4] = { x: 0.4, y: 0.3, z: 0 };
  hand[8] = { x: 0.42, y: 0.3, z: 0 };
  const scaled = hand.map((p) => ({ x: p.x * 0.5, y: p.y * 0.5, z: p.z }));
  expect(handControls([hand], 0).attractors[0]?.force).toBeCloseTo(
    handControls([scaled], 0).attractors[0]?.force ?? 0,
    6
  );
});
test("missing or low-confidence body landmarks do not attract", () => {
  expect(handControls([], 0).attractors).toEqual([]);
  const body = Array.from({ length: 33 }, () => ({
    visibility: 0.2,
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  expect(poseControls(body, 0).attractors).toEqual([]);
});
