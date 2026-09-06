import { defaultAudio } from "@sonara/shared";
import type { AudioFeatureFrame } from "@sonara/shared";
import Meyda from "meyda";

import { autoGain, createAutoGainState, median } from "./analyzer-dsp";
import { classifyOnset } from "./onset-classify";
import { detectKey, estimateBpm } from "./tempo";

const clamp = (n: number) => Math.max(0, Math.min(1, n));

// Fixed-rate analysis, called with audio sample timestamps rather than display time.
export class FeatureAnalyzer {
  private previous = new Float32Array(1024);
  private flux: number[] = [];
  private lastTime = 0;
  private lastOnset = -1;
  private lastTempo = 0;
  private bpm = 0;
  private phase = 0;
  private energy = 0;
  private bassGain = createAutoGainState();
  private midsGain = createAutoGainState();
  private highGain = createAutoGainState();
  private sampleRate: number;
  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }
  reset(): void {
    this.previous.fill(0);
    this.flux = [];
    this.lastTime = 0;
    this.lastOnset = -1;
    this.lastTempo = 0;
    this.bpm = 0;
    this.phase = 0;
    this.energy = 0;
    this.bassGain = createAutoGainState();
    this.midsGain = createAutoGainState();
    this.highGain = createAutoGainState();
  }
  // oxlint-disable-next-line complexity -- REVIEW: fixed-rate DSP pipeline; keep band and onset calculations together
  process(samples: Float32Array, time: number): AudioFeatureFrame {
    Meyda.sampleRate = this.sampleRate;
    Meyda.bufferSize = samples.length;
    const extracted = Meyda.extract(
      ["amplitudeSpectrum", "spectralFlatness", "spectralRolloff", "chroma"],
      samples
    );
    if (
      !extracted ||
      typeof extracted !== "object" ||
      !("amplitudeSpectrum" in extracted)
    ) {
      return { confidence: 0, features: { ...defaultAudio }, time };
    }
    const spectrum = extracted.amplitudeSpectrum as Float32Array;
    const gap = this.lastTime > 0 ? Math.max(0, time - this.lastTime) : 1 / 60;
    const dt = Math.min(0.2, gap);
    // Keep onset history on the audio clock. Short scheduling gaps occupy
    // empty slots instead of compressing time or erasing several bars.
    if (gap > 0.5) {
      this.flux = [];
      this.bpm = 0;
    } else {
      for (let missing = 1; missing < Math.round(gap * 60); missing += 1) {
        this.flux.push(0);
      }
    }
    this.lastTime = time;
    let sum = 0;
    let dc = 0;
    for (const sample of samples) {
      dc += sample;
    }
    dc /= samples.length;
    for (const sample of samples) {
      sum += (sample - dc) ** 2;
    }
    const rms = clamp(Math.sqrt(sum / samples.length));
    const ends = [
      Math.floor((250 * samples.length) / this.sampleRate),
      Math.floor((2000 * samples.length) / this.sampleRate),
      Math.floor((10_000 * samples.length) / this.sampleRate),
    ];
    const bands = [0, 0, 0];
    const rises = [0, 0, 0];
    let centroid = 0;
    let mass = 0;
    for (let i = 0; i < spectrum.length; i += 1) {
      const amplitude = spectrum[i] ?? 0;
      const value = clamp(
        (20 * Math.log10(Math.max(1e-8, amplitude / samples.length)) + 80) / 60
      );
      let band = 2;
      if (i < (ends[0] ?? 0)) {
        band = 0;
      } else if (i < (ends[1] ?? 0)) {
        band = 1;
      }
      if (i < (ends[2] ?? 0)) {
        bands[band] = (bands[band] ?? 0) + value;
        rises[band] =
          (rises[band] ?? 0) + Math.max(0, value - (this.previous[i] ?? 0));
      }
      this.previous[i] = value;
      centroid += i * amplitude;
      mass += amplitude;
    }
    const widths = [
      ends[0] ?? 1,
      (ends[1] ?? 1) - (ends[0] ?? 0),
      (ends[2] ?? 1) - (ends[1] ?? 0),
    ];
    const gainOptions = { decay: Math.exp(-dt / 11), floor: 0.08 };
    const bass = autoGain(
      (bands[0] ?? 0) / (widths[0] ?? 1),
      this.bassGain,
      gainOptions
    );
    const mids = autoGain(
      (bands[1] ?? 0) / (widths[1] ?? 1),
      this.midsGain,
      gainOptions
    );
    const treble = autoGain(
      (bands[2] ?? 0) / (widths[2] ?? 1),
      this.highGain,
      gainOptions
    );
    const flux = rises.reduce((a, b) => a + b, 0) / spectrum.length;
    const recent = this.flux.slice(-60);
    const center = median(recent);
    const deviation = Math.sqrt(
      recent.reduce((a, b) => a + (b - center) ** 2, 0) /
        Math.max(1, recent.length)
    );
    const onset =
      rms > 0.005 &&
      flux > Math.max(0.002, center + deviation * 1.5) &&
      time - this.lastOnset > 0.1;
    if (onset) {
      this.lastOnset = time;
    }
    this.flux.push(flux);
    if (this.flux.length > 480) {
      this.flux.splice(0, this.flux.length - 480);
    }
    if (this.flux.length >= 240 && time - this.lastTempo >= 0.5) {
      this.bpm = estimateBpm(this.flux, this.bpm);
      this.lastTempo = time;
    }
    this.phase = this.bpm > 0 ? (this.phase + (dt * this.bpm) / 60) % 1 : 0;
    if (onset && this.bpm > 0) {
      this.phase =
        (this.phase +
          (this.phase < 0.5 ? -this.phase : 1 - this.phase) * 0.1 +
          1) %
        1;
    }
    this.energy += (rms - this.energy) * (1 - Math.exp(-dt / 1.3));
    const brightness = mass > 0 ? centroid / mass / spectrum.length : 0;
    const flatness = clamp(Number(extracted.spectralFlatness) || 0);
    const rolloff = clamp(
      (Number(extracted.spectralRolloff) || 0) / (this.sampleRate / 2)
    );
    const key = detectKey([...(extracted.chroma ?? [])]);
    return {
      confidence:
        this.bpm > 0
          ? clamp(1 - deviation / Math.max(0.001, flux + deviation)) * 0.4 + 0.5
          : 0,
      features: {
        ...defaultAudio,
        arousal: clamp(this.energy * 3 + flux * 6),
        bass,
        bpm: this.bpm,
        bpmPhase: this.phase,
        centroid: brightness,
        flatness,
        keyStrength: key?.strength ?? 0,
        mids,
        onset,
        ...(onset
          ? {
              onsetType: classifyOnset({
                bass,
                bassFlux: (rises[0] ?? 0) / (widths[0] ?? 1),
                centroid: brightness,
                flatness,
                mids,
                midsFlux: (rises[1] ?? 0) / (widths[1] ?? 1),
                rms,
                treble,
                trebleFlux: (rises[2] ?? 0) / (widths[2] ?? 1),
              }),
            }
          : {}),
        rms,
        rolloff,
        sectionEnergy: this.energy,
        tonalCenter: key?.tonic ?? 0,
        treble,
        valence: clamp(brightness * 0.6 + rolloff * 0.4),
      },
      time,
    };
  }
}
