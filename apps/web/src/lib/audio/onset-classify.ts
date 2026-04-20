import type { OnsetType } from "@music-visualizer/shared";

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
export function classifyOnset(input: {
  bass: number;
  mids: number;
  treble: number;
  centroid: number; // 0..1
  rms: number;
  flatness: number;
}): OnsetType {
  const { bass, mids, treble, centroid, rms, flatness } = input;

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
}
