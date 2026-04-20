"use client";

import { useEffect, useRef } from "react";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// Full frequency spectrum as a silhouetted ink polyline with a faint hanko-red
// fill beneath. Uses a smaller internal FFT window (via a dedicated AnalyserNode
// would be ideal, but reusing the engine's 2048-bin analyser and downsampling
// to 96 visible bins keeps the stack single-analyser).
const VISIBLE_BINS = 96;

export function SpectrumCurve({ height = 28 }: { height?: number }) {
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

    let freqBuf: Uint8Array<ArrayBuffer> | null = null;
    // Smoothing buffer: one damped value per visible bin, so the spectrum
    // doesn't flicker on frame-to-frame jitter.
    const smoothed = new Float32Array(VISIBLE_BINS);

    const paperStroke = "rgba(237, 231, 217, 0.75)"; // var(--paper)
    const hankoFill = "rgba(164, 52, 58, 0.10)";     // var(--hanko) alpha 10%

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getCurrentAudioEngine();
      const analyser = engine?.getAnalyser() ?? null;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);

      if (!analyser) {
        // Idle silhouette: quiet low bump so the strip reads as "waiting for audio".
        ctx.fillStyle = hankoFill;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < VISIBLE_BINS; i++) {
          const x = (i / (VISIBLE_BINS - 1)) * w;
          const y = h - Math.sin((i / VISIBLE_BINS) * Math.PI) * h * 0.12;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fill();
        return;
      }

      const bins = analyser.frequencyBinCount;
      if (!freqBuf || freqBuf.length !== bins) {
        freqBuf = new Uint8Array(new ArrayBuffer(bins));
      }
      analyser.getByteFrequencyData(freqBuf);

      // Bucket `bins` source bins into `VISIBLE_BINS` target bins via averaging.
      // Compressed to the lower ~60% of frequency range (drums+mids+presence)
      // because the upper end is typically dead weight.
      const usableBins = Math.floor(bins * 0.6);
      const binsPerBucket = usableBins / VISIBLE_BINS;

      for (let i = 0; i < VISIBLE_BINS; i++) {
        const start = Math.floor(i * binsPerBucket);
        const end = Math.max(start + 1, Math.floor((i + 1) * binsPerBucket));
        let sum = 0;
        for (let j = start; j < end; j++) sum += freqBuf[j]!;
        const avg = sum / (end - start) / 255; // 0..1
        smoothed[i] = (smoothed[i] ?? 0) * 0.55 + avg * 0.45;
      }

      // Filled polyline (hanko-tinted) + ink stroke on top.
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let i = 0; i < VISIBLE_BINS; i++) {
        const x = (i / (VISIBLE_BINS - 1)) * w;
        const v = smoothed[i] ?? 0;
        const y = h - v * h * 0.92;
        if (i === 0) ctx.lineTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = hankoFill;
      ctx.fill();

      ctx.beginPath();
      for (let i = 0; i < VISIBLE_BINS; i++) {
        const x = (i / (VISIBLE_BINS - 1)) * w;
        const v = smoothed[i] ?? 0;
        const y = h - v * h * 0.92;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = paperStroke;
      ctx.lineWidth = 0.75;
      ctx.lineJoin = "round";
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
