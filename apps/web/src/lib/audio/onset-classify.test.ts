import { describe, expect, test } from "bun:test";

import { classifyOnset } from "./onset-classify";

// Baseline energies that, without band fluxes, fall through to "other" — so any
// classification below is attributable to the band-flux fast path.
const neutral = {
  bass: 0.2,
  centroid: 0.2,
  flatness: 0.15,
  mids: 0.2,
  rms: 0.1,
  treble: 0.2,
};

describe("classifyOnset band-flux fast path", () => {
  test("dominant bass flux + low centroid → kick", () => {
    expect(
      classifyOnset({
        ...neutral,
        bassFlux: 0.5,
        centroid: 0.1,
        midsFlux: 0.05,
        trebleFlux: 0.05,
      })
    ).toBe("kick");
  });

  test("dominant treble flux + high centroid → hat", () => {
    expect(
      classifyOnset({
        ...neutral,
        bassFlux: 0.05,
        centroid: 0.5,
        midsFlux: 0.05,
        trebleFlux: 0.5,
      })
    ).toBe("hat");
  });

  test("dominant mids flux, noisy → snare", () => {
    expect(
      classifyOnset({
        ...neutral,
        bassFlux: 0.05,
        flatness: 0.3,
        midsFlux: 0.5,
        trebleFlux: 0.05,
      })
    ).toBe("snare");
  });

  test("dominant mids flux, tonal → vocal", () => {
    expect(
      classifyOnset({
        ...neutral,
        bassFlux: 0.05,
        centroid: 0.25,
        flatness: 0.1,
        midsFlux: 0.5,
        trebleFlux: 0.05,
      })
    ).toBe("vocal");
  });

  test("no clear dominant band → falls through to energy heuristics", () => {
    // Equal fluxes: fast path declines, neutral energies → "other".
    expect(
      classifyOnset({
        ...neutral,
        bassFlux: 0.2,
        midsFlux: 0.2,
        trebleFlux: 0.2,
      })
    ).toBe("other");
  });

  test("omitting fluxes preserves the original energy behavior (kick)", () => {
    // The classic energy-only kick case still classifies without any fluxes.
    expect(
      classifyOnset({
        bass: 0.5,
        centroid: 0.1,
        flatness: 0.15,
        mids: 0.1,
        rms: 0.1,
        treble: 0.1,
      })
    ).toBe("kick");
  });
});
