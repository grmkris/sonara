import { describe, expect, test } from "bun:test";

import { DECK_LOOK, DEFAULT_CADENCE } from "./decks";
import {
  MAX_FRAME_DURATION_MS,
  MIN_FRAME_DURATION_MS,
  cadenceBetweenMs,
  clampFrameDurationMs,
  libraryCadenceMs,
} from "./library";

describe("cadenceBetweenMs", () => {
  const bounds = { calm: 8000, loud: 2000 };

  test("interpolates between calm and loud by intensity", () => {
    expect(cadenceBetweenMs(0, bounds)).toBe(8000);
    expect(cadenceBetweenMs(1, bounds)).toBe(2000);
    expect(cadenceBetweenMs(0.5, bounds)).toBe(5000);
  });

  test("clamps intensity outside 0..1", () => {
    expect(cadenceBetweenMs(-3, bounds)).toBe(8000);
    expect(cadenceBetweenMs(7, bounds)).toBe(2000);
  });
});

describe("clampFrameDurationMs", () => {
  test("keeps an in-range duration (rounded to whole ms)", () => {
    expect(clampFrameDurationMs(2500)).toBe(2500);
    expect(clampFrameDurationMs(2500.4)).toBe(2500);
  });

  test("clamps below the floor and above the ceiling", () => {
    expect(clampFrameDurationMs(0)).toBe(MIN_FRAME_DURATION_MS);
    expect(clampFrameDurationMs(-1000)).toBe(MIN_FRAME_DURATION_MS);
    expect(clampFrameDurationMs(999_999)).toBe(MAX_FRAME_DURATION_MS);
  });

  test("the bounds are usable (floor < ceiling)", () => {
    expect(MIN_FRAME_DURATION_MS).toBeLessThan(MAX_FRAME_DURATION_MS);
  });
});

describe("libraryCadenceMs", () => {
  test("uses the deck's DECK_LOOK bounds when present", () => {
    const { noir } = DECK_LOOK;
    expect(noir).toBeDefined();
    expect(libraryCadenceMs(0, "noir")).toBe(noir?.cadence.calm as number);
    expect(libraryCadenceMs(1, "noir")).toBe(noir?.cadence.loud as number);
  });

  test("falls back to the app default for look-less decks", () => {
    expect(libraryCadenceMs(0, "wild")).toBe(DEFAULT_CADENCE.calm);
    expect(libraryCadenceMs(0, null)).toBe(DEFAULT_CADENCE.calm);
    expect(libraryCadenceMs(1)).toBe(DEFAULT_CADENCE.loud);
  });
});
