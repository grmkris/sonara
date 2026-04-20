"use client";

import { useEffect, useRef } from "react";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// Thin paper-coloured ink line that traces the time-domain waveform at the
// AnalyserNode's native rate (~60Hz). Reads directly from the shared engine —
// no store plumbing — so resolution is the full 2048-sample buffer, not the
// 5Hz Zustand upstream. When no audio is attached, renders a flat line so the
// UI doesn't go suddenly dead.
const STROKE_ALPHA_MIN = 0.12;
const STROKE_ALPHA_MAX = 0.7;

interface WaveformRibbonProps {
  // CSS height for the canvas element; width fills the parent.
  height?: number;
}

export function WaveformRibbon({ height = 36 }: WaveformRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize observer keeps the backing store aligned to display pixels so
    // the stroke stays crisp on retina and during window resize.
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

    // Single reusable buffer — AnalyserNode wants a fresh copy each call but
    // we can share one Uint8Array across frames. Backed by a concrete
    // ArrayBuffer so TS narrows it to `Uint8Array<ArrayBuffer>`.
    let buf: Uint8Array<ArrayBuffer> | null = null;
    const paperColor = "rgba(237, 231, 217, 1)"; // var(--paper) literal — canvas can't read CSS vars directly.

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getCurrentAudioEngine();
      const analyser = engine?.getAnalyser() ?? null;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      if (!analyser) {
        // Idle: flat hairline so the strip doesn't disappear when no source.
        ctx.globalAlpha = STROKE_ALPHA_MIN;
        ctx.strokeStyle = paperColor;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        return;
      }

      const bins = analyser.fftSize;
      if (!buf || buf.length !== bins) {
        buf = new Uint8Array(new ArrayBuffer(bins));
      }
      analyser.getByteTimeDomainData(buf);

      // Compute amplitude (RMS of the buffer, fast integer approximation)
      // for alpha gating — keeps the stroke from shouting when source is quiet.
      let sum = 0;
      for (let i = 0; i < bins; i++) {
        const d = buf[i]! - 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / bins) / 128;
      const alpha =
        STROKE_ALPHA_MIN + (STROKE_ALPHA_MAX - STROKE_ALPHA_MIN) * Math.min(1, rms * 2.4);

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = paperColor;
      ctx.lineWidth = 0.9;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const slice = w / bins;
      for (let i = 0; i < bins; i++) {
        const v = (buf[i]! - 128) / 128; // -1..1
        const y = h / 2 + v * (h / 2) * 0.85;
        const x = i * slice;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
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
