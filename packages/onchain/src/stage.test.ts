/* oxlint-disable no-inline-comments -- inline expectation notes aid test readability */
import { describe, expect, test } from "bun:test";

import {
  bytes32ToRoom,
  fromFixedPoint,
  knobFromIndex,
  knobIndex,
  roomToBytes32,
  STAGE_KNOBS,
  toFixedPoint,
} from "./stage";

describe("room <-> bytes32", () => {
  test("round-trips short room codes", () => {
    for (const room of ["abc123", "STAGE-7", "x", "room_42_aZ"]) {
      const hex = roomToBytes32(room);
      expect(hex).toHaveLength(66); // 0x + 32 bytes
      expect(bytes32ToRoom(hex)).toBe(room);
    }
  });
});

describe("fixed-point", () => {
  test("maps [0,1] to [0,1000] and back within rounding", () => {
    for (const v of [0, 0.25, 0.5, 0.731, 1]) {
      expect(toFixedPoint(v)).toBe(Math.round(v * 1000));
      expect(fromFixedPoint(toFixedPoint(v))).toBeCloseTo(v, 2);
    }
  });

  test("clamps out-of-range input", () => {
    expect(toFixedPoint(-0.5)).toBe(0);
    expect(toFixedPoint(2)).toBe(1000);
  });
});

describe("knob enum order matches the contract", () => {
  test("intensity is index 0 and round-trips", () => {
    expect(knobIndex("intensity")).toBe(0);
    expect(STAGE_KNOBS).toEqual([
      "intensity",
      "softness",
      "surrealness",
      "abstraction",
      "stability",
    ]);
    for (const [i, k] of STAGE_KNOBS.entries()) {
      expect(knobFromIndex(i)).toBe(k);
    }
  });
});
