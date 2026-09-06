import { expect, test } from "bun:test";

import type { Attractor, PerformanceControlFrame } from "@sonara/shared";

import { SurfaceControls, surfacePoint } from "./surface-controls";

const empty: PerformanceControlFrame = {
  attractors: [],
  expansion: 0.5,
  rotation: 0,
  time: 0,
};
const hand = (changes: Partial<Attractor> = {}): Attractor => ({
  facing: 1,
  force: 1,
  id: 0,
  palm: 0.15,
  pinch: 1,
  tipX: 0.3,
  tipY: 0.5,
  x: 0.3,
  y: 0.5,
  ...changes,
});
const input = (...attractors: Attractor[]): PerformanceControlFrame => ({
  ...empty,
  attractors,
});

test("pinch anchors the fingertip, survives threshold noise, and releases with momentum", () => {
  const solver = new SurfaceControls();
  let frame = solver.step(empty, input(hand()), 0, 0);
  expect(frame.contacts?.[0]).toMatchObject({
    anchorX: 0.3,
    anchorY: 0.5,
    held: true,
  });
  for (let i = 0; i < 30; i += 1) {
    frame = solver.step(
      frame,
      input(hand({ pinch: 0.6, tipX: 0.65 })),
      0,
      i / 60
    );
  }
  const contact = frame.contacts?.[0];
  expect(contact?.anchorX).toBe(0.3);
  expect(contact?.x).toBeCloseTo(0.65, 4);
  expect(contact?.held).toBe(true);
  const mapped = surfacePoint(contact?.x ?? 0, 0.5, frame.contacts ?? []);
  expect(mapped.x).toBeCloseTo(0.3, 5);
  frame = solver.step(frame, input(hand({ pinch: 0.2 })), 0, 1);
  expect(frame.contacts?.[0]?.held).toBe(false);
  expect(frame.contacts?.[0]?.strength).toBeGreaterThan(0.9);
  for (let i = 0; i < 240; i += 1) {
    frame = solver.step(frame, empty, 1, 1 + i / 60);
  }
  expect(frame.contacts).toEqual([]);
});

test("two hands retain their own anchors through reordering and lost tracking releases both", () => {
  const solver = new SurfaceControls();
  let frame = solver.step(
    empty,
    input(hand(), hand({ id: 1, tipX: 0.7 })),
    0,
    0
  );
  frame = solver.step(
    frame,
    input(hand({ id: 1, tipX: 0.9 }), hand({ tipX: 0.1 })),
    0,
    1 / 60
  );
  expect(frame.contacts?.map((p) => [p.id, p.anchorX])).toEqual([
    [0, 0.3],
    [1, 0.7],
  ]);
  for (const contact of frame.contacts ?? []) {
    expect(
      surfacePoint(contact.x, contact.y, frame.contacts ?? []).x
    ).toBeCloseTo(contact.anchorX, 3);
  }
  frame = solver.step(frame, input(hand()), 0.4, 1);
  expect(frame.contacts?.every((p) => !p.held)).toBe(true);
  solver.reset();
  expect(solver.step(empty, empty, 0, 0).contacts).toEqual([]);
});

test("push/pull calibrates per pinch and ignores turning a palm edge-on", () => {
  const solver = new SurfaceControls();
  let frame = solver.step(empty, input(hand()), 0, 0);
  for (let i = 0; i < 60; i += 1) {
    frame = solver.step(frame, input(hand({ palm: 0.25 })), 0, i / 60);
  }
  const pressure = frame.contacts?.[0]?.pressure ?? 0;
  expect(pressure).toBeGreaterThan(0.8);
  for (let i = 0; i < 60; i += 1) {
    frame = solver.step(
      frame,
      input(hand({ facing: 0.2, palm: 0.06 })),
      0,
      i / 60
    );
  }
  expect(frame.contacts?.[0]?.pressure).toBe(pressure);
  frame = solver.step(frame, input(hand({ pinch: 0 })), 0, 2);
  frame = solver.step(frame, input(hand({ palm: 0.25 })), 0, 3);
  expect(frame.contacts?.[0]?.pressure).toBe(0);
});
