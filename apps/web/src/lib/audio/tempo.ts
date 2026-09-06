// Krumhansl-Kessler key profiles (major + minor). Each is a 12-entry
// hierarchy of tonal prominence for a C-rooted scale; other keys are
// obtained by rotating the profile. Standard MIR reference.
const KK_MAJOR = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];
const KK_MINOR = [
  6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// Pearson correlation of two 12-vectors.
const pearson12 = (a: number[], b: number[]): number => {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i += 1) {
    meanA += a[i] ?? 0;
    meanB += b[i] ?? 0;
  }
  meanA /= 12;
  meanB /= 12;
  let num = 0;
  let dA = 0;
  let dB = 0;
  for (let i = 0; i < 12; i += 1) {
    const ai = (a[i] ?? 0) - meanA;
    const bi = (b[i] ?? 0) - meanB;
    num += ai * bi;
    dA += ai * ai;
    dB += bi * bi;
  }
  const denom = Math.sqrt(dA * dB);
  return denom > 1e-9 ? num / denom : 0;
};

// Autocorrelation BPM on a flux ring buffer sampled at ~60 Hz. Prefers
// tempos close to the previous estimate to smooth wobble between halves
// and doubles (a common failure mode of single-lag picks).
export const estimateBpm = (
  flux: number[],
  prevBpm: number,
  fps = 60
): number => {
  const minBpm = 60;
  const maxBpm = 180;
  let bestBpm = 0;
  let bestScore = -Infinity;
  const len = flux.length;
  // Zero-mean the input so the DC component doesn't dominate.
  let m = 0;
  for (let i = 0; i < len; i += 1) {
    m += flux[i] ?? 0;
  }
  m /= len;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 1) {
    const lag = Math.round((fps * 60) / bpm);
    if (lag <= 0 || lag >= len) {
      continue;
    }
    let corr = 0;
    for (let i = lag; i < len; i += 1) {
      corr += ((flux[i] ?? 0) - m) * ((flux[i - lag] ?? 0) - m);
    }
    // Prefer BPMs close to the previous estimate — 3% bonus per 10 BPM of
    // agreement. Prevents half/double jumps when the peak is a near-tie.
    if (prevBpm > 0) {
      const dist = Math.abs(bpm - prevBpm);
      corr *= 1 + Math.max(0, 0.03 * (1 - dist / 10));
    }
    if (corr > bestScore) {
      bestScore = corr;
      bestBpm = bpm;
    }
  }
  // Reject low-confidence matches: if the peak score is tiny relative to the
  // signal variance, don't publish a BPM yet.
  let variance = 0;
  for (let i = 0; i < len; i += 1) {
    const d = (flux[i] ?? 0) - m;
    variance += d * d;
  }
  if (variance <= 1e-6 || bestScore / variance < 0.15) {
    return 0;
  }
  return bestBpm;
};

// Returns the best-matching key (tonic 0..11, mode, correlation 0..1).
// Null when the chroma vector is empty (no harmonic content detected).
export const detectKey = (
  chroma: number[]
): { tonic: number; mode: "major" | "minor"; strength: number } | null => {
  let total = 0;
  for (let i = 0; i < 12; i += 1) {
    total += chroma[i] ?? 0;
  }
  if (total < 1e-6) {
    return null;
  }
  let bestTonic = 0;
  let bestMode: "major" | "minor" = "major";
  let bestCorr = -Infinity;
  const rotated: number[] = Array.from({ length: 12 }, () => 0);
  for (let tonic = 0; tonic < 12; tonic += 1) {
    // rotate the profile so index 0 corresponds to this tonic
    for (let i = 0; i < 12; i += 1) {
      rotated[i] = KK_MAJOR[(i - tonic + 12) % 12] ?? 0;
    }
    const cMaj = pearson12(chroma, rotated);
    for (let i = 0; i < 12; i += 1) {
      rotated[i] = KK_MINOR[(i - tonic + 12) % 12] ?? 0;
    }
    const cMin = pearson12(chroma, rotated);
    if (cMaj > bestCorr) {
      bestCorr = cMaj;
      bestTonic = tonic;
      bestMode = "major";
    }
    if (cMin > bestCorr) {
      bestCorr = cMin;
      bestTonic = tonic;
      bestMode = "minor";
    }
  }
  // Clamp negative correlations to 0 for cleanliness.
  return { mode: bestMode, strength: Math.max(0, bestCorr), tonic: bestTonic };
};
