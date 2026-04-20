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

  // Per-frame feature caches populated from Meyda callbacks. RMS and centroid
  // are *not* here — they're computed in-loop from the analyser's own data so
  // they don't stall at 0 if Meyda's script processor fails to start.
  private flatnessFromMeyda = 0;
  private rolloffFromMeyda = 0;
  private fluxFromMeyda = 0;
  private chromaFromMeyda: number[] | null = null;
  private mfccFromMeyda: number[] | null = null;

  private prevSpectrum: Float32Array | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;
  // EMA-smoothed mood components. Initialised to neutral so an idle UI
  // doesn't display 0/0 before the first audio tick.
  private valenceSmoothed = 0.5;
  private arousalSmoothed = 0;
  private lastTickAt: number | null = null;
  private fluxHistory: number[] = [];
  private rmsHistory: number[] = [];
  private lastOnsetAt = 0;
  private callback: TickCallback | null = null;

  async attachElement(el: HTMLAudioElement): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) return;
    // A cached source node created against a previous (now-closed)
    // AudioContext will throw InvalidAccessError on connect() below — the
    // cache survives stop() because WeakMap keys the node to the <audio>
    // element, not the context. Validate context identity before reuse and
    // drop stale entries.
    let node = elementSourceCache.get(el);
    if (node && node.context !== this.ctx) {
      try {
        node.disconnect();
      } catch {
        // noop
      }
      elementSourceCache.delete(el);
      node = undefined;
    }
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

  // Exposes the live AnalyserNode so high-rate consumers (WaveformRibbon,
  // SpectrumCurve) can read byte data directly at 60Hz instead of going
  // through the 5Hz Zustand upstream.
  getAnalyser(): AnalyserNode | null {
    return this.analyser;
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
    this.timeBuffer = null;
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
    this.timeBuffer = new Uint8Array(new ArrayBuffer(analyser.fftSize));
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
          "spectralFlatness",
          "spectralRolloff",
          "spectralFlux",
          "chroma",
          "mfcc",
        ],
        callback: (features: {
          spectralFlatness?: number;
          spectralRolloff?: number;
          spectralFlux?: number;
          chroma?: number[];
          mfcc?: number[];
        }) => {
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
    } catch (err) {
      // Meyda supplies flatness/rolloff/chroma/mfcc. RMS + centroid are now
      // computed locally so this failure degrades gracefully — log so we
      // notice instead of silently losing features.
      console.warn(
        "[AudioEngine] Meyda init failed — spectral flatness/rolloff/chroma/mfcc will stay at 0",
        err,
      );
      this.meydaAnalyzer = null;
    }
  }

  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    if (
      !this.analyser ||
      !this.ctx ||
      !this.callback ||
      !this.freqBuffer ||
      !this.timeBuffer
    )
      return;

    const bins = this.analyser.frequencyBinCount;
    const freq = this.freqBuffer;
    const time = this.timeBuffer;
    this.analyser.getByteFrequencyData(freq);
    this.analyser.getByteTimeDomainData(time);

    // RMS computed from time-domain samples (byte, centred on 128). Matches
    // WaveformRibbon's formula; independent of Meyda so it never stalls at 0.
    let sumSq = 0;
    for (let i = 0; i < time.length; i++) {
      const d = (time[i] ?? 128) - 128;
      sumSq += d * d;
    }
    const rms = Math.sqrt(sumSq / time.length) / 128;

    // Spectral centroid from the frequency buffer — also free here, avoids
    // the Meyda dependency for this core feature.
    let num = 0;
    let den = 0;
    for (let i = 0; i < bins; i++) {
      const v = (freq[i] ?? 0) / 255;
      num += i * v;
      den += v;
    }
    const centroid = den > 0 ? num / den / bins : 0;

    // 2D mood vector. Valence (bright↔dark) from spectral brightness,
    // arousal (calm↔energetic) from energy + change. EMA-smoothed so we feed
    // a stable signal to the downstream LLM instead of per-frame jitter.
    const tickNow = performance.now();
    const lastTick = this.lastTickAt ?? tickNow;
    const dtMs = Math.max(1, tickNow - lastTick);
    this.lastTickAt = tickNow;
    // τ ≈ 1300ms → α = 1 - exp(-dt/τ). Frame-rate independent.
    const alpha = 1 - Math.exp(-dtMs / 1300);
    const valenceRaw = centroid * 0.6 + this.rolloffFromMeyda * 0.4;
    // Meyda's spectralFlux is unbounded; normalize via a soft compression
    // (tanh on ×6) so the arousal component stays 0..1-ish.
    const fluxNorm = Math.tanh(this.fluxFromMeyda * 6);
    const arousalRaw = rms * 0.5 + fluxNorm * 0.5;
    this.valenceSmoothed = this.valenceSmoothed + alpha * (valenceRaw - this.valenceSmoothed);
    this.arousalSmoothed = this.arousalSmoothed + alpha * (arousalRaw - this.arousalSmoothed);

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
        centroid,
        rms,
        flatness: this.flatnessFromMeyda,
      });
    }

    this.rmsHistory.push(rms);
    if (this.rmsHistory.length > 60) this.rmsHistory.shift();
    const sectionEnergy = avg(this.rmsHistory);

    const payload: AudioFeatures = {
      rms,
      bass,
      mids,
      treble,
      centroid,
      flatness: this.flatnessFromMeyda,
      rolloff: this.rolloffFromMeyda,
      flux: this.fluxFromMeyda,
      onset,
      sectionEnergy,
      valence: Math.max(0, Math.min(1, this.valenceSmoothed)),
      arousal: Math.max(0, Math.min(1, this.arousalSmoothed)),
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
