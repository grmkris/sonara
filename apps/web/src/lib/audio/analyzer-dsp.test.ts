import { describe, expect, test } from "bun:test";

import {
  autoGain,
  createAutoGainState,
  median,
  spectralFluxBand,
  weightedRms,
} from "./analyzer-dsp";

// Build a byte time-domain buffer (centred on 128) from a -1..1 generator.
const buf = (n: number, fn: (i: number) => number): Uint8Array =>
  Uint8Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.min(255, Math.round(128 + fn(i) * 127)))
  );

describe("weightedRms", () => {
  test("is 0 for an empty buffer", () => {
    expect(weightedRms(new Uint8Array(0))).toBe(0);
  });

  test("attenuates a pure DC offset toward 0", () => {
    // Constant offset = DC; a high-pass should reject it almost entirely.
    const dc = buf(2048, () => 0.5);
    expect(weightedRms(dc)).toBeLessThan(0.05);
  });

  test("passes an audible mid-frequency tone", () => {
    // ~1kHz-ish tone over the 48k buffer: well above the high-pass cutoff.
    const tone = buf(2048, (i) => Math.sin((i / 2048) * Math.PI * 2 * 40));
    expect(weightedRms(tone)).toBeGreaterThan(0.3);
  });

  test("stays within 0..1", () => {
    const loud = buf(2048, (i) => (i % 2 === 0 ? 1 : -1));
    const r = weightedRms(loud);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe("autoGain", () => {
  test("normalises a small steady value toward full range", () => {
    const state = createAutoGainState();
    let out = 0;
    // A quiet-but-present band (0.2) should climb toward 1 as its peak settles.
    for (let i = 0; i < 5; i += 1) {
      out = autoGain(0.2, state);
    }
    expect(out).toBeGreaterThan(0.9);
  });

  test("floors silence at ~0 instead of amplifying noise", () => {
    const state = createAutoGainState();
    // Tiny noise floor must not get boosted to full range.
    expect(autoGain(0.001, state)).toBeLessThan(0.05);
  });

  test("snaps up instantly to a new peak (never exceeds 1)", () => {
    const state = createAutoGainState();
    autoGain(0.2, state);
    // sudden transient
    const out = autoGain(0.9, state);
    expect(out).toBeLessThanOrEqual(1);
    expect(out).toBeGreaterThan(0.9);
  });
});

describe("median", () => {
  test("is 0 for an empty array", () => {
    expect(median([])).toBe(0);
  });

  test("odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test("is not dragged up by peaks the way the mean is", () => {
    // One big transient among a quiet baseline: mean jumps, median holds.
    const stream = [0.01, 0.01, 0.02, 0.01, 0.9];
    const mean = stream.reduce((a, b) => a + b, 0) / stream.length;
    expect(median(stream)).toBeLessThan(mean);
    expect(median(stream)).toBeLessThan(0.1);
  });
});

describe("spectralFluxBand", () => {
  // an all-zeros previous spectrum
  const prev = new Float32Array(8);

  test("returns 0 for an empty band", () => {
    const freq = new Uint8Array(8).fill(255);
    expect(spectralFluxBand(freq, prev, 3, 3)).toBe(0);
  });

  test("isolates rising energy within a band", () => {
    // Energy rises only in bins [4,6).
    const freq = new Uint8Array(8);
    freq[4] = 255;
    freq[5] = 255;
    // bass band sees no rise; the band containing [4,6) does.
    expect(spectralFluxBand(freq, prev, 0, 4)).toBe(0);
    expect(spectralFluxBand(freq, prev, 4, 6)).toBeGreaterThan(0.9);
  });

  test("counts only positive change (energy falling = 0 flux)", () => {
    const hot = new Float32Array(8).fill(1);
    // freq dropped to 0 → all deltas negative → 0 flux
    const freq = new Uint8Array(8);
    expect(spectralFluxBand(freq, hot, 0, 8)).toBe(0);
  });
});
