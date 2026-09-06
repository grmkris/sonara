import { expect, test } from "bun:test";

import {
  groupControls,
  handControls,
  poseControls,
  unionMasks,
} from "./vision-controls";

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

const person = (offset: number, lift: number) => {
  const points = Array.from({ length: 33 }, () => ({
    visibility: 1,
    x: 0.5 + offset,
    y: 0.5,
    z: 0,
  }));
  points[11] = { visibility: 1, x: 0.4 + offset, y: 0.5, z: 0 };
  points[12] = { visibility: 1, x: 0.6 + offset, y: 0.5, z: 0 };
  points[15] = { visibility: 1, x: 0.2 + offset, y: 0.5 - lift, z: 0 };
  points[16] = { visibility: 1, x: 0.8 + offset, y: 0.5 - lift, z: 0 };
  return points;
};

test("a room shares two stable controls even when detection order changes", () => {
  const bodies = [person(-0.2, 0), person(0, 0.1), person(0.2, 0.2)];
  const forward = groupControls(bodies, 1);
  const reversed = groupControls(bodies.toReversed(), 1);
  expect(forward.attractors).toHaveLength(2);
  expect(forward.lift).toBeCloseTo(0.5);
  expect(reversed.lift).toBeCloseTo(forward.lift ?? 0);
  expect(reversed.attractors[0]?.x).toBeCloseTo(forward.attractors[0]?.x ?? 0);
  expect(groupControls([[], ...bodies.slice(0, 2)], 1).lift).toBeCloseTo(0.25);
  expect(groupControls([], 1).attractors).toEqual([]);
});

test("silhouette union preserves every person without brightening overlaps", () => {
  const a = { data: new Float32Array([1, 0.6, 0, 0]), height: 1, width: 4 };
  const b = { data: new Float32Array([0, 0.6, 0.4, 1]), height: 1, width: 4 };
  expect([...unionMasks([a, b], 4, 1)]).toEqual([255, 153, 102, 255]);
  expect(unionMasks([a, b], 4, 1)).toEqual(unionMasks([b, a], 4, 1));
  expect([...unionMasks([a], 2, 1)]).toEqual([255, 0]);
  expect(unionMasks([], 0, 0)).toHaveLength(0);
});
