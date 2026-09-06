"use client";
// oxlint-disable unicorn/require-post-message-target-origin -- REVIEW: MessagePort.postMessage has no targetOrigin argument

import { defaultAudio } from "@sonara/shared";
import type { AudioFeatures, AudioFeatureFrame } from "@sonara/shared";

import { createClipRecorder } from "./recorder";
import type { ClipRecorder } from "./recorder";

type TickCallback = (features: AudioFeatures) => void;
const FFT_SIZE = 2048;
const SAMPLE_RATE = 48_000;
const elementSourceCache = new WeakMap<
  HTMLAudioElement,
  MediaElementAudioSourceNode
>();

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private source: AudioNode | null = null;
  private clipRecorder: ClipRecorder | null = null;
  private mediaStream: MediaStream | null = null;
  private callback: TickCallback | null = null;
  private sourceLostCb: (() => void) | null = null;
  private worker: Worker | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mute: GainNode | null = null;
  private generation = 0;
  private initialization: Promise<void> | null = null;
  private stopped = false;
  latest: AudioFeatureFrame = {
    confidence: 0,
    features: { ...defaultAudio },
    time: 0,
  };

  async attachElement(el: HTMLAudioElement): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) {
      return;
    }
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
    if (this.worklet) {
      this.compressor.connect(this.worklet);
      this.worklet.port.postMessage({ active: true });
    }
    this.startClipRecorder(this.compressor);
  }

  async attachMic(): Promise<void> {
    await this.ensureContext();
    this.detachSource();
    if (!this.ctx || !this.analyser || !this.compressor) {
      return;
    }
    // Request RAW capture. The browser defaults echoCancellation /
    // noiseSuppression / autoGainControl to ON and tuned for *speech* — fine
    // for a phone call, destructive for a music feed (AGC pumps levels,
    // noise-suppression chews sustained pads, all of which wreck beat
    // detection). This is the path used for a club line/USB feed (e.g. a
    // Pioneer DJM master over USB, or REC OUT → a USB interface), so turn the
    // voice DSP off and analyse the music as-is.
    const { generation } = this;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        autoGainControl: false,
        echoCancellation: false,
        noiseSuppression: false,
      },
      video: false,
    });
    if (this.stopped || generation !== this.generation) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    this.mediaStream = stream;
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    // Do NOT connect analyser to destination on mic (avoid feedback).
    this.source = node;
    if (this.worklet) {
      this.compressor.connect(this.worklet);
      this.worklet.port.postMessage({ active: true });
    }
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
    if (!this.ctx || !this.analyser || !this.compressor) {
      return;
    }
    const { generation } = this;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
    // We only want audio; stop the video track immediately.
    for (const t of stream.getVideoTracks()) {
      t.stop();
    }
    const [audioTrack] = stream.getAudioTracks();
    if (!audioTrack) {
      // User shared a source with no audio (or Safari silently stripped it).
      for (const t of stream.getTracks()) {
        t.stop();
      }
      throw Object.assign(new Error("no audio track in display capture"), {
        name: "NoAudioTrackError",
      });
    }
    if (this.stopped || generation !== this.generation) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
      return;
    }
    this.mediaStream = stream;
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.compressor);
    this.compressor.connect(this.analyser);
    // Do NOT connect to destination — the tab is still playing normally.
    this.source = node;
    if (this.worklet) {
      this.compressor.connect(this.worklet);
      this.worklet.port.postMessage({ active: true });
    }
    this.startClipRecorder(this.compressor);
    // When the user clicks "Stop sharing" in the browser chrome, the track
    // ends on its own. Detach and notify the UI so it can reset the source
    // picker back to "none".
    audioTrack.addEventListener("ended", () => {
      this.detachSource();
      this.sourceLostCb?.();
    });
  }

  // oxlint-disable-next-line prefer-await-to-callbacks -- REVIEW: event-style registration API; a one-shot promise can't model a repeatable source-lost notification
  onSourceLost(cb: () => void): void {
    this.sourceLostCb = cb;
  }

  detachSource(): void {
    this.worklet?.port.postMessage({ active: false });
    this.generation += 1;
    this.worker?.postMessage({ generation: this.generation, type: "reset" });
    this.latest = {
      confidence: 0,
      features: { ...defaultAudio },
      time: this.ctx?.currentTime ?? 0,
    };
    this.callback?.(this.latest.features);
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
        if (this.analyser) {
          this.compressor.disconnect(this.analyser);
        }
        if (this.worklet) {
          this.compressor.disconnect(this.worklet);
        }
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
      for (const t of this.mediaStream.getTracks()) {
        t.stop();
      }
      this.mediaStream = null;
    }
  }

  // oxlint-disable-next-line prefer-await-to-callbacks -- REVIEW: per-frame tick subscription; fires ~60x/s, not a one-shot promise
  onTick(cb: TickCallback): void {
    this.callback = cb;
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
  // oxlint-disable-next-line require-await -- REVIEW: async keeps the return type a Promise on both the null and delegated paths
  async grabClip(): Promise<{
    blob: Blob;
    mimeType: string;
  } | null> {
    if (!this.clipRecorder) {
      return null;
    }
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
    if (!this.ctx || !this.compressor || !this.source) {
      return null;
    }
    const { compressor } = this;
    const dest = this.ctx.createMediaStreamDestination();
    compressor.connect(dest);
    return {
      dispose: () => {
        try {
          compressor.disconnect(dest);
        } catch {
          // noop
        }
        for (const t of dest.stream.getTracks()) {
          t.stop();
        }
      },
      stream: dest.stream,
    };
  }

  stop(): void {
    this.stopped = true;
    this.worker?.terminate();
    this.worker = null;
    this.worklet?.disconnect();
    this.worklet?.port.close();
    this.worklet = null;
    this.mute?.disconnect();
    this.mute = null;
    this.detachSource();
    if (this.ctx) {
      // oxlint-disable-next-line prefer-await-to-then -- REVIEW: stop() is sync; closing the context is fire-and-forget
      this.ctx.close().catch(() => {
        // noop
      });
      this.ctx = null;
    }
    this.analyser = null;
    this.compressor = null;
  }

  private async ensureContext(): Promise<void> {
    this.initialization ??= this.createContext();
    try {
      await this.initialization;
      await this.ctx?.resume();
    } catch (error) {
      this.initialization = null;
      throw error;
    }
  }
  private async createContext(): Promise<void> {
    if (this.ctx) {
      await this.ctx.resume();
      return;
    }
    if (this.stopped) {
      throw new Error("audio engine stopped");
    }
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
    try {
      await ctx.audioWorklet.addModule("/audio/capture-worklet.js");
      if (this.stopped) {
        await ctx.close();
        return;
      }
      const worklet = new AudioWorkletNode(ctx, "sonara-capture");
      const worker = new Worker(new URL("analysis.worker.ts", import.meta.url));
      const channel = new MessageChannel();
      worker.postMessage(
        { port: channel.port1, sampleRate: ctx.sampleRate, type: "init" },
        [channel.port1]
      );
      worklet.port.postMessage({ port: channel.port2 }, [channel.port2]);
      worker.addEventListener(
        "message",
        (event: MessageEvent<AudioFeatureFrame & { generation: number }>) => {
          if (event.data.generation !== this.generation || !this.source) {
            return;
          }
          this.latest = event.data;
          this.callback?.(event.data.features);
        }
      );
      worker.addEventListener("error", (event) => {
        console.error("Audio analysis failed", event.message);
        this.detachSource();
        this.sourceLostCb?.();
      });
      const mute = ctx.createGain();
      mute.gain.value = 0;
      worklet.connect(mute);
      mute.connect(ctx.destination);
      this.worker = worker;
      this.worklet = worklet;
      this.mute = mute;
    } catch (error) {
      await ctx.close();
      this.ctx = null;
      throw error;
    }
  }

  private startClipRecorder(source: AudioNode): void {
    if (!this.ctx) {
      return;
    }
    try {
      this.clipRecorder = createClipRecorder(this.ctx, source, {
        windowMs: 6000,
      });
      if (!this.clipRecorder) {
        console.warn(
          "[AudioEngine] MediaRecorder unsupported — song recognition disabled in this browser"
        );
      }
    } catch (error) {
      console.warn("[AudioEngine] clip recorder init failed", error);
      this.clipRecorder = null;
    }
  }
}
