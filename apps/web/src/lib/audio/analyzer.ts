"use client";

import Meyda from "meyda";
import type { AudioFeatures, OnsetType } from "@sonara/shared";
import { classifyOnset } from "./onset-classify";
import { createClipRecorder, type ClipRecorder } from "./recorder";

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
  private clipRecorder: ClipRecorder | null = null;
  private rafId: number | null = null;
  private mediaStream: MediaStream | null = null;

  // Per-frame feature caches populated from Meyda callbacks. RMS and centroid
  // are *not* here — they're computed in-loop from the analyser's own data so
  // they don't stall at 0 if Meyda's script processor fails to start.
  private flatnessFromMeyda = 0;
  private rolloffFromMeyda = 0;
  private chromaFromMeyda: number[] = new Array(12).fill(0);
  // Local spectral flux carried across ticks so the arousal EMA has a fresh
  // value before this tick recomputes it. Meyda's own spectralFlux extractor
  // was removed — it throws inside its ScriptProcessorNode callback at ~90Hz
  // when the previousSignal buffer is missing/malformed, spamming the console
  // with uncaught TypeErrors. Our local flux (computed below from AnalyserNode
  // byte-freq data) is what we want anyway.
  private lastFluxLocal = 0;

  private prevSpectrum: Float32Array | null = null;
  private freqBuffer: Uint8Array<ArrayBuffer> | null = null;
  private timeBuffer: Uint8Array<ArrayBuffer> | null = null;
  // EMA-smoothed mood components. Initialised to neutral so an idle UI
  // doesn't display 0/0 before the first audio tick.
  private valenceSmoothed = 0.5;
  private arousalSmoothed = 0;
  private keyStrengthSmoothed = 0;
  // tonalCenter is an int pitch class — not EMA'd, latched from the last
  // high-confidence correlation to avoid wobbling between near-ties.
  private tonalCenterLatched = 0;
  private lastTickAt: number | null = null;
  private fluxHistory: number[] = [];
  private rmsHistory: number[] = [];
  // Longer flux buffer for tempo autocorrelation. Holds ~8s at ~60 Hz.
  private beatFluxHistory: number[] = [];
  private bpmEst = 0;
  private bpmPhase = 0;
  private lastBpmAnalysisAt = 0;
  private lastOnsetAt = 0;
  private callback: TickCallback | null = null;
  // Fired when the active source disappears of its own accord — primarily
  // when the user hits "Stop sharing" in the browser chrome on a display
  // capture. Component code can listen and reset the UI source selector.
  private sourceLostCb: (() => void) | null = null;

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
    this.startClipRecorder(this.compressor);
  }

  async attachMic(): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) return;
    // Request RAW capture. The browser defaults echoCancellation /
    // noiseSuppression / autoGainControl to ON and tuned for *speech* — fine
    // for a phone call, destructive for a music feed (AGC pumps levels,
    // noise-suppression chews sustained pads, all of which wreck beat
    // detection). This is the path used for a club line/USB feed (e.g. a
    // Pioneer DJM master over USB, or REC OUT → a USB interface), so turn the
    // voice DSP off and analyse the music as-is.
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
      video: false,
    });
    this.mediaStream = stream;
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    // Do NOT connect analyser to destination on mic (avoid feedback).
    this.source = node;
    this.startMeyda(this.compressor);
    this.startClipRecorder(this.compressor);
  }

  // Capture a MediaStream from `getDisplayMedia` — lets the user share a
  // browser tab (or window/screen where supported) and visualise its audio.
  // Spec requires video: true even when we only want audio; we stop the
  // video track immediately. The analyser is NOT routed to destination
  // because the shared tab is still playing to the system output — routing
  // again would double-play.
  async attachDisplay(): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    // We only want audio; stop the video track immediately.
    for (const t of stream.getVideoTracks()) t.stop();
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) {
      // User shared a source with no audio (or Safari silently stripped it).
      for (const t of stream.getTracks()) t.stop();
      throw Object.assign(new Error("no audio track in display capture"), {
        name: "NoAudioTrackError",
      });
    }
    this.mediaStream = stream;
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    // Do NOT connect to destination — the tab is still playing normally.
    this.source = node;
    this.startMeyda(this.compressor);
    this.startClipRecorder(this.compressor);
    // When the user clicks "Stop sharing" in the browser chrome, the track
    // ends on its own. Detach and notify the UI so it can reset the source
    // picker back to "none".
    audioTrack.addEventListener("ended", () => {
      this.detachSource();
      this.sourceLostCb?.();
    });
  }

  onSourceLost(cb: () => void): void {
    this.sourceLostCb = cb;
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
    if (this.clipRecorder) {
      this.clipRecorder.stop();
      this.clipRecorder = null;
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

  // Grab the most recent ~6s of audio from the clip-recorder ring buffer,
  // base64-encoded and ready to ship over WS for song recognition. Null if
  // no source is attached or MediaRecorder isn't available.
  async grabClip(): Promise<{
    blob: Blob;
    mimeType: string;
  } | null> {
    if (!this.clipRecorder) return null;
    return this.clipRecorder.grabClip();
  }

  // Cheap presence check for the recognition hook — lets the identify UI
  // distinguish "no audio source attached" (show a nudge) from "audio
  // attached but recogniser returned no match" (show the couldn't-identify
  // toast). Doesn't consult the ring's fill state — that's grabClip's job.
  hasClipRecorder(): boolean {
    return this.clipRecorder !== null;
  }

  // Tap a dedicated MediaStream off the compressor for full-length video
  // recording. Independent of the ClipRecorder ring buffer. Returns null
  // when no source is attached. Caller invokes dispose() to release.
  createRecordingStream(): { stream: MediaStream; dispose: () => void } | null {
    if (!this.ctx || !this.compressor || !this.source) return null;
    const compressor = this.compressor;
    const dest = this.ctx.createMediaStreamDestination();
    compressor.connect(dest);
    return {
      stream: dest.stream,
      dispose: () => {
        try {
          compressor.disconnect(dest);
        } catch {
          // noop
        }
        for (const t of dest.stream.getTracks()) t.stop();
      },
    };
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

  private startClipRecorder(source: AudioNode): void {
    if (!this.ctx) return;
    try {
      this.clipRecorder = createClipRecorder(this.ctx, source, {
        windowMs: 6000,
      });
      if (!this.clipRecorder) {
        console.warn(
          "[AudioEngine] MediaRecorder unsupported — song recognition disabled in this browser",
        );
      }
    } catch (err) {
      console.warn("[AudioEngine] clip recorder init failed", err);
      this.clipRecorder = null;
    }
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
          "chroma",
        ],
        callback: (features: {
          spectralFlatness?: number;
          spectralRolloff?: number;
          chroma?: number[];
        }) => {
          if (typeof features.spectralFlatness === "number") {
            this.flatnessFromMeyda = features.spectralFlatness;
          }
          if (typeof features.spectralRolloff === "number") {
            // Rolloff arrives in Hz. Normalize against Nyquist.
            const nyq = (this.ctx?.sampleRate ?? SAMPLE_RATE) / 2;
            this.rolloffFromMeyda = Math.min(1, features.spectralRolloff / nyq);
          }
          if (Array.isArray(features.chroma) && features.chroma.length === 12) {
            this.chromaFromMeyda = features.chroma;
          }
        },
      });
      this.meydaAnalyzer.start();
    } catch (err) {
      // Meyda supplies flatness/rolloff/chroma. RMS, centroid, and flux are
      // computed locally so this failure degrades gracefully — log so we notice
      // instead of silently losing features.
      console.warn(
        "[AudioEngine] Meyda init failed — spectral flatness/rolloff/chroma will stay at 0",
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
    // Local spectral flux (previous tick's value — see `lastFluxLocal` field;
    // recomputed below for this tick). Normalised with tanh(×6) so arousal
    // stays in a 0..1-ish range; the EMA τ of 1.3s absorbs the 1-frame lag.
    const fluxNorm = Math.tanh(this.lastFluxLocal * 6);
    const arousalRaw = rms * 0.5 + fluxNorm * 0.5;
    this.valenceSmoothed = this.valenceSmoothed + alpha * (valenceRaw - this.valenceSmoothed);
    this.arousalSmoothed = this.arousalSmoothed + alpha * (arousalRaw - this.arousalSmoothed);

    // Harmonic key correlation from Meyda's chroma. keyStrength smooths on a
    // slower τ (~3s) than mood because harmony is a slower signal. tonalCenter
    // latches on high-confidence detections so nearby keys don't oscillate.
    const keyAlpha = 1 - Math.exp(-dtMs / 3000);
    const key = detectKey(this.chromaFromMeyda);
    const keyStrengthRaw = key ? key.strength : 0;
    this.keyStrengthSmoothed =
      this.keyStrengthSmoothed + keyAlpha * (keyStrengthRaw - this.keyStrengthSmoothed);
    if (key && key.strength > 0.6) {
      this.tonalCenterLatched = key.tonic;
    }

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

    this.lastFluxLocal = flux;

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

    // Autocorrelation BPM detection on the local (fine-grained) flux signal.
    // Re-estimate every ~500ms. Phase advances every frame from the current
    // bpm estimate so it stays continuous across re-estimations.
    this.beatFluxHistory.push(flux);
    if (this.beatFluxHistory.length > 480) this.beatFluxHistory.shift();
    if (
      this.beatFluxHistory.length >= 240 &&
      now - this.lastBpmAnalysisAt > 500
    ) {
      this.lastBpmAnalysisAt = now;
      this.bpmEst = estimateBpm(this.beatFluxHistory, this.bpmEst);
    }
    if (this.bpmEst > 0) {
      this.bpmPhase =
        (this.bpmPhase + (dtMs / 1000) * (this.bpmEst / 60)) % 1;
    } else {
      this.bpmPhase = 0;
    }

    const payload: AudioFeatures = {
      rms,
      bass,
      mids,
      treble,
      centroid,
      flatness: this.flatnessFromMeyda,
      rolloff: this.rolloffFromMeyda,
      onset,
      sectionEnergy,
      valence: Math.max(0, Math.min(1, this.valenceSmoothed)),
      arousal: Math.max(0, Math.min(1, this.arousalSmoothed)),
      keyStrength: Math.max(0, Math.min(1, this.keyStrengthSmoothed)),
      tonalCenter: this.tonalCenterLatched,
      bpm: this.bpmEst,
      bpmPhase: this.bpmPhase,
    };
    if (onsetType) payload.onsetType = onsetType;

    this.callback(payload);
  };
}

function mean(arr: Uint8Array<ArrayBuffer>, start: number, end: number): number {
  if (end <= start) return 0;
  let sum = 0;
  for (let i = start; i < end; i++) sum += arr[i] ?? 0;
  return sum / (end - start);
}

// Krumhansl-Kessler key profiles (major + minor). Each is a 12-entry
// hierarchy of tonal prominence for a C-rooted scale; other keys are
// obtained by rotating the profile. Standard MIR reference.
const KK_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Pearson correlation of two 12-vectors.
function pearson12(a: number[], b: number[]): number {
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < 12; i++) {
    meanA += a[i] ?? 0;
    meanB += b[i] ?? 0;
  }
  meanA /= 12;
  meanB /= 12;
  let num = 0;
  let dA = 0;
  let dB = 0;
  for (let i = 0; i < 12; i++) {
    const ai = (a[i] ?? 0) - meanA;
    const bi = (b[i] ?? 0) - meanB;
    num += ai * bi;
    dA += ai * ai;
    dB += bi * bi;
  }
  const denom = Math.sqrt(dA * dB);
  return denom > 1e-9 ? num / denom : 0;
}

// Autocorrelation BPM on a flux ring buffer sampled at ~60 Hz. Prefers
// tempos close to the previous estimate to smooth wobble between halves
// and doubles (a common failure mode of single-lag picks).
function estimateBpm(flux: number[], prevBpm: number): number {
  const fps = 60;
  const minBpm = 60;
  const maxBpm = 180;
  let bestBpm = 0;
  let bestScore = -Infinity;
  const len = flux.length;
  // Zero-mean the input so the DC component doesn't dominate.
  let m = 0;
  for (let i = 0; i < len; i++) m += flux[i] ?? 0;
  m /= len;
  for (let bpm = minBpm; bpm <= maxBpm; bpm++) {
    const lag = Math.round((fps * 60) / bpm);
    if (lag <= 0 || lag >= len) continue;
    let corr = 0;
    for (let i = lag; i < len; i++) {
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
  for (let i = 0; i < len; i++) {
    const d = (flux[i] ?? 0) - m;
    variance += d * d;
  }
  if (variance <= 1e-6 || bestScore / variance < 0.15) return 0;
  return bestBpm;
}

// Returns the best-matching key (tonic 0..11, mode, correlation 0..1).
// Null when the chroma vector is empty (no harmonic content detected).
function detectKey(
  chroma: number[],
): { tonic: number; mode: "major" | "minor"; strength: number } | null {
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i] ?? 0;
  if (total < 1e-6) return null;
  let bestTonic = 0;
  let bestMode: "major" | "minor" = "major";
  let bestCorr = -Infinity;
  const rotated: number[] = new Array(12);
  for (let tonic = 0; tonic < 12; tonic++) {
    // rotate the profile so index 0 corresponds to this tonic
    for (let i = 0; i < 12; i++) {
      rotated[i] = KK_MAJOR[(i - tonic + 12) % 12] ?? 0;
    }
    const cMaj = pearson12(chroma, rotated);
    for (let i = 0; i < 12; i++) {
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
  return { tonic: bestTonic, mode: bestMode, strength: Math.max(0, bestCorr) };
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
