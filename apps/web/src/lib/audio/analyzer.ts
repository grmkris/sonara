"use client";

import Meyda from "meyda";
import type { AudioFeatures, OnsetType } from "@music-visualizer/shared";
import { classifyOnset } from "./onset-classify";

// Browser-side audio engine. Runs a single AudioContext + AnalyserNode for the
// life of the component. Sources (an <audio> element or a mic MediaStream) are
// hot-swapped via attachElement / attachMic / detachSource without closing the
// context. Emits AudioFeatures at ~60 Hz via requestAnimationFrame.

type TickCallback = (features: AudioFeatures) => void;

const FFT_SIZE = 2048;
const SAMPLE_RATE = 48_000;
const MEYDA_BUFFER_SIZE = 512;

// MediaElementAudioSourceNode may only be constructed once per <audio> element
// per AudioContext. Re-picking a file reuses the cached node.
const elementSourceCache = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>();

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private source: AudioNode | null = null;
  private meydaAnalyzer: ReturnType<typeof Meyda.createMeydaAnalyzer> | null =
    null;
  private rafId: number | null = null;
  private mediaStream: MediaStream | null = null;

  // Per-frame feature caches populated from Meyda callbacks.
  private rmsFromMeyda = 0;
  private centroidFromMeyda = 0;
  private flatnessFromMeyda = 0;
  private rolloffFromMeyda = 0;
  private fluxFromMeyda = 0;
  private chromaFromMeyda: number[] | null = null;
  private mfccFromMeyda: number[] | null = null;

  private prevSpectrum: Float32Array | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private fluxHistory: number[] = [];
  private rmsHistory: number[] = [];
  private lastOnsetAt = 0;
  private callback: TickCallback | null = null;

  async attachElement(el: HTMLAudioElement): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) return;
    let node = elementSourceCache.get(el);
    if (!node) {
      node = this.ctx.createMediaElementSource(el);
      elementSourceCache.set(el, node);
    }
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.source = node;
    this.startMeyda(this.compressor);
  }

  async attachMic(): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    this.mediaStream = stream;
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    // Do NOT connect analyser to destination on mic (avoid feedback).
    this.source = node;
    this.startMeyda(this.compressor);
  }

  detachSource(): void {
    if (this.meydaAnalyzer) {
      try {
        this.meydaAnalyzer.stop();
      } catch {
        // noop
      }
      this.meydaAnalyzer = null;
    }
    if (this.source) {
      try {
        this.source.disconnect();
      } catch {
        // noop
      }
      this.source = null;
    }
    if (this.compressor) {
      try {
        this.compressor.disconnect();
      } catch {
        // noop
      }
    }
    if (this.analyser && this.ctx) {
      try {
        this.analyser.disconnect(this.ctx.destination);
      } catch {
        // noop — analyser may not have been connected to destination
      }
    }
    if (this.mediaStream) {
      for (const t of this.mediaStream.getTracks()) t.stop();
      this.mediaStream = null;
    }
  }

  onTick(cb: TickCallback): void {
    this.callback = cb;
    if (this.rafId === null) this.loop();
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.detachSource();
    if (this.ctx) {
      this.ctx.close().catch(() => undefined);
      this.ctx = null;
    }
    this.analyser = null;
    this.compressor = null;
    this.freqBuffer = null;
    this.prevSpectrum = null;
  }

  private async ensureContext(): Promise<void> {
    if (this.ctx) return;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctor({ sampleRate: SAMPLE_RATE });
    if (ctx.state === "suspended") {
      try {
        await ctx.resume();
      } catch {
        // noop
      }
    }

    // Light AGC — flattens level drift between quiet and loud songs so the
    // spectral-flux onset detector's adaptive threshold stays useful.
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.25;
    compressor.knee.value = 10;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.8;

    this.ctx = ctx;
    this.compressor = compressor;
    this.analyser = analyser;
    this.freqBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    this.prevSpectrum = new Float32Array(analyser.frequencyBinCount);
  }

  private startMeyda(source: AudioNode): void {
    if (!this.ctx) return;
    try {
      this.meydaAnalyzer = Meyda.createMeydaAnalyzer({
        audioContext: this.ctx,
        source,
        bufferSize: MEYDA_BUFFER_SIZE,
        featureExtractors: [
          "rms",
          "spectralCentroid",
          "spectralFlatness",
          "spectralRolloff",
          "spectralFlux",
          "chroma",
          "mfcc",
        ],
        callback: (features: {
          rms?: number;
          spectralCentroid?: number;
          spectralFlatness?: number;
          spectralRolloff?: number;
          spectralFlux?: number;
          chroma?: number[];
          mfcc?: number[];
        }) => {
          if (typeof features.rms === "number") this.rmsFromMeyda = features.rms;
          if (typeof features.spectralCentroid === "number") {
            const maxBin = MEYDA_BUFFER_SIZE / 2;
            this.centroidFromMeyda = Math.min(
              1,
              features.spectralCentroid / maxBin,
            );
          }
          if (typeof features.spectralFlatness === "number") {
            this.flatnessFromMeyda = features.spectralFlatness;
          }
          if (typeof features.spectralRolloff === "number") {
            // Rolloff arrives in Hz. Normalize against Nyquist.
            const nyq = (this.ctx?.sampleRate ?? SAMPLE_RATE) / 2;
            this.rolloffFromMeyda = Math.min(1, features.spectralRolloff / nyq);
          }
          if (typeof features.spectralFlux === "number") {
            this.fluxFromMeyda = features.spectralFlux;
          }
          if (Array.isArray(features.chroma) && features.chroma.length === 12) {
            this.chromaFromMeyda = features.chroma;
          }
          if (Array.isArray(features.mfcc) && features.mfcc.length === 13) {
            this.mfccFromMeyda = features.mfcc;
          }
        },
      });
      this.meydaAnalyzer.start();
    } catch {
      this.meydaAnalyzer = null;
    }
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (!this.analyser || !this.ctx || !this.callback || !this.freqBuffer)
      return;

    const bins = this.analyser.frequencyBinCount;
    const freq = this.freqBuffer;
    this.analyser.getByteFrequencyData(freq);

    const nyquist = this.ctx.sampleRate / 2;
    const binHz = nyquist / bins;

    const bassEnd = Math.floor(250 / binHz);
    const midsEnd = Math.floor(2000 / binHz);
    const trebleEnd = Math.min(bins, Math.floor(10_000 / binHz));

    const bass = mean(freq, 0, bassEnd) / 255;
    const mids = mean(freq, bassEnd, midsEnd) / 255;
    const treble = mean(freq, midsEnd, trebleEnd) / 255;

    // Spectral flux for onset detection (our own, not Meyda's — finer-grained).
    let flux = 0;
    const prev = this.prevSpectrum;
    if (prev && prev.length === bins) {
      for (let i = 0; i < bins; i++) {
        const curr = (freq[i] ?? 0) / 255;
        const delta = curr - (prev[i] ?? 0);
        if (delta > 0) flux += delta;
      }
      flux /= bins;
    }
    if (!prev || prev.length !== bins) {
      this.prevSpectrum = new Float32Array(bins);
    }
    const p = this.prevSpectrum;
    if (p) {
      for (let i = 0; i < bins; i++) p[i] = (freq[i] ?? 0) / 255;
    }

    this.fluxHistory.push(flux);
    if (this.fluxHistory.length > 60) this.fluxHistory.shift();
    const fluxMean = avg(this.fluxHistory);
    const fluxStd = stddev(this.fluxHistory, fluxMean);

    const now = performance.now();
    const onset =
      flux > fluxMean + fluxStd * 1.5 && now - this.lastOnsetAt > 100;

    let onsetType: OnsetType | undefined;
    if (onset) {
      this.lastOnsetAt = now;
      onsetType = classifyOnset({
        bass,
        mids,
        treble,
        centroid: this.centroidFromMeyda,
        rms: this.rmsFromMeyda,
        flatness: this.flatnessFromMeyda,
      });
    }

    const rms = this.rmsFromMeyda;
    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > 60) this.rmsHistory.shift();
    const sectionEnergy = avg(this.rmsHistory);

    const payload: AudioFeatures = {
      rms,
      bass,
      mids,
      treble,
      centroid: this.centroidFromMeyda,
      flatness: this.flatnessFromMeyda,
      rolloff: this.rolloffFromMeyda,
      flux: this.fluxFromMeyda,
      onset,
      sectionEnergy,
    };
    if (onsetType) payload.onsetType = onsetType;
    if (this.chromaFromMeyda) payload.chroma = this.chromaFromMeyda;
    if (this.mfccFromMeyda) payload.mfcc = this.mfccFromMeyda;

    this.callback(payload);
  };
}

function mean(arr: Uint8Array<ArrayBuffer>, start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += arr[i] ?? 0;
  return sum / (end - start);
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += v;
  return sum / arr.length;
}

function stddev(arr: number[], m: number): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const v of arr) sum += (v - m) * (v - m);
  return Math.sqrt(sum / arr.length);
}
