import type { OnsetType } from "@sonara/shared";

// Classify a detected onset using spectral tilt + band energies at the moment
// of the onset. Zero-dep, zero-allocation, pure function.
//
// Heuristics:
//   kick   — bass-dominant, low centroid, strong RMS
//   snare  — broadband mid-energy, medium centroid, fast transient
//   hat    — treble-dominant, high centroid, low RMS
//   vocal  — mid-band sustained energy, moderate centroid
//   other  — anything that doesn't cleanly fit
//
// Centroid arrives from Meyda normalized to 0..1 against the FFT buffer
// (bin index / bufferSize/2). These thresholds are empirical.
// Band-flux fast path: an onset is a transient, so the band where energy
// *rises* fastest is the most reliable drum-type cue. Returns a type only when
// one band clearly leads (≥1.4× the others); otherwise null, so ambiguous hits
// fall back to the energy heuristics in classifyOnset.
const classifyByBandFlux = (
  bf: number,
  mf: number,
  tf: number,
  centroid: number,
  flatness: number
): OnsetType | null => {
  if (bf + mf + tf <= 0) {
    return null;
  }
  if (tf > bf * 1.4 && tf > mf * 1.4 && centroid > 0.3) {
    return "hat";
  }
  if (bf > mf * 1.4 && bf > tf * 1.4 && centroid < 0.25) {
    return "kick";
  }
  if (mf > bf * 1.4 && mf > tf * 1.4) {
    return flatness < 0.2 && centroid > 0.15 ? "vocal" : "snare";
  }
  return null;
};

interface OnsetEnergies {
  bass: number;
  mids: number;
  treble: number;
  centroid: number;
  rms: number;
  flatness: number;
}

// The original energy-tilt heuristics (drum-type from where steady energy sits
// at the onset moment). Used as the fallback when band fluxes don't clearly
// resolve the hit.
const classifyByEnergy = (e: OnsetEnergies): OnsetType => {
  const { bass, mids, treble, centroid, rms, flatness } = e;

  // Hats: treble-dominant over bass, high centroid, modest RMS.
  if (treble > 0.35 && treble > bass * 1.5 && centroid > 0.4) {
    return "hat";
  }

  // Kicks: bass-dominant, low centroid, decent RMS.
  if (bass > 0.35 && bass > treble * 1.3 && centroid < 0.18 && rms > 0.05) {
    return "kick";
  }

  // Snares: mids energy wins over bass and treble both; noise-ish (high
  // flatness) and medium centroid are the giveaway.
  if (
    mids > 0.28 &&
    mids > bass * 0.9 &&
    mids > treble * 0.9 &&
    flatness > 0.25 &&
    centroid > 0.12 &&
    centroid < 0.45
  ) {
    return "snare";
  }

  // Vocal/tonal onsets: mids sustain with low flatness (tonal, not noise).
  if (mids > 0.22 && flatness < 0.2 && centroid > 0.15 && centroid < 0.45) {
    return "vocal";
  }

  return "other";
};

export const classifyOnset = (
  input: OnsetEnergies & {
    // Optional per-band positive spectral flux at the onset (kick=low,
    // snare=mid, hat=high). When provided and one band clearly dominates the
    // *transient*, it's a stronger drum-type signal than steady band energy.
    // Omitting them falls through to the energy heuristics unchanged.
    bassFlux?: number;
    midsFlux?: number;
    trebleFlux?: number;
  }
): OnsetType =>
  classifyByBandFlux(
    input.bassFlux ?? 0,
    input.midsFlux ?? 0,
    input.trebleFlux ?? 0,
    input.centroid,
    input.flatness
  ) ?? classifyByEnergy(input);
