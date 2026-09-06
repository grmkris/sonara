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

const makeHand = (x: number) => {
  const hand = Array.from({ length: 21 }, () => ({ x, y: 0.5, z: 0 }));
  hand[9] = { x, y: 0.3, z: 0 };
  hand[4] = { x: x - 0.15, y: 0.3, z: 0 };
  hand[8] = { x: x + 0.15, y: 0.3, z: 0 };
  return hand;
};

test("open hands have a visible pull and identity survives crossing and detection reorder", () => {
  const left = makeHand(0.7);
  const right = makeHand(0.3);
  const forward = handControls([left, right], 1, [0, 1]);
  const reverse = handControls([right, left], 1, [1, 0]);
  expect(forward).toEqual(reverse);
  expect(forward.attractors[0]?.force).toBeGreaterThanOrEqual(0.6);
  const crossed = handControls([makeHand(0.2), makeHand(0.8)], 2, [0, 1]);
  expect(crossed.attractors.map((point) => point.id)).toEqual([0, 1]);
  expect(crossed.attractors[0]?.x).toBeGreaterThan(
    crossed.attractors[1]?.x ?? 0
  );
});

test("body spread and lift are independent of camera distance and framing", () => {
  const body = Array.from({ length: 33 }, () => ({
    visibility: 1,
    x: 0.5,
    y: 0.5,
    z: 0,
  }));
  body[11] = { visibility: 1, x: 0.4, y: 0.5, z: 0 };
  body[12] = { visibility: 1, x: 0.6, y: 0.5, z: 0 };
  body[15] = { visibility: 1, x: 0.2, y: 0.3, z: 0 };
  body[16] = { visibility: 1, x: 0.8, y: 0.3, z: 0 };
  const near = poseControls(body, 1);
  const far = poseControls(
    body.map((p) => ({ ...p, x: p.x * 0.5 + 0.15, y: p.y * 0.5 + 0.2 })),
    1
  );
  expect(far.expansion).toBeCloseTo(near.expansion);
  expect(far.lift).toBeCloseTo(near.lift ?? 0);
  expect(near.lift).toBeGreaterThan(0.8);
  expect(far.attractors[0]?.x).toBeCloseTo(near.attractors[0]?.x ?? 0);
});
