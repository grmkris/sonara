"use client";

import { useEffect, useRef } from "react";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// Single combined waveform + spectrum shape. Spectrum is a faint stone
// silhouette filling beneath the waveform; the waveform itself is a 1 px
// paper-coloured ink stroke on top. Reads the AnalyserNode directly at 60 Hz
// (no store round-trip). Merges what used to be WaveformRibbon + SpectrumCurve
// into one elegant shape so the audio strip stops reading as DAW telemetry.

const VISIBLE_BINS = 96;
const STROKE_ALPHA_MIN = 0.14;
const STROKE_ALPHA_MAX = 0.75;

interface AudioRibbonProps {
  height?: number;
}

export function AudioRibbon({ height = 40 }: AudioRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) return;
      canvas.width = Math.floor(clientWidth * dpr);
      canvas.height = Math.floor(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let waveBuf: Uint8Array<ArrayBuffer> | null = null;
    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    const smoothed = new Float32Array(VISIBLE_BINS);

    const paperStroke = "rgba(237, 231, 217, 1)"; // --paper literal
    const stoneFill = "rgba(140, 133, 120, 0.14)"; // --stone @ 14 %

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getCurrentAudioEngine();
      const analyser = engine?.getAnalyser() ?? null;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      if (!analyser) {
        // Idle: flat hairline across the centre.
        ctx.globalAlpha = STROKE_ALPHA_MIN;
        ctx.strokeStyle = paperStroke;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        return;
      }

      // ── Spectrum silhouette ───────────────────────────────────────
      const fftBins = analyser.frequencyBinCount;
      if (!freqBuf || freqBuf.length !== fftBins) {
        freqBuf = new Uint8Array(new ArrayBuffer(fftBins));
      }
      analyser.getByteFrequencyData(freqBuf);

      const usableBins = Math.floor(fftBins * 0.6);
      const binsPerBucket = usableBins / VISIBLE_BINS;
      for (let i = 0; i < VISIBLE_BINS; i++) {
        const start = Math.floor(i * binsPerBucket);
        const end = Math.max(start + 1, Math.floor((i + 1) * binsPerBucket));
        let sum = 0;
        for (let j = start; j < end; j++) sum += freqBuf[j] ?? 0;
        const avg = sum / (end - start) / 255;
        smoothed[i] = (smoothed[i] ?? 0) * 0.55 + avg * 0.45;
      }

      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < VISIBLE_BINS; i++) {
        const x = (i / (VISIBLE_BINS - 1)) * w;
        const v = smoothed[i] ?? 0;
        const y = h - v * h * 0.88;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = stoneFill;
      ctx.fill();

      // ── Waveform stroke (on top) ──────────────────────────────────
      const waveBins = analyser.fftSize;
      if (!waveBuf || waveBuf.length !== waveBins) {
        waveBuf = new Uint8Array(new ArrayBuffer(waveBins));
      }
      analyser.getByteTimeDomainData(waveBuf);

      let sum = 0;
      for (let i = 0; i < waveBins; i++) {
        const d = (waveBuf[i] ?? 128) - 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / waveBins) / 128;
      const alpha =
        STROKE_ALPHA_MIN +
        (STROKE_ALPHA_MAX - STROKE_ALPHA_MIN) * Math.min(1, rms * 2.4);

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = paperStroke;
      ctx.lineWidth = 0.9;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const slice = w / waveBins;
      for (let i = 0; i < waveBins; i++) {
        const v = ((waveBuf[i] ?? 128) - 128) / 128; // -1..1
        const y = h / 2 + v * (h / 2) * 0.78;
        const x = i * slice;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="block w-full"
      style={{ height, width: "100%" }}
    />
  );
}
