"use client";

import { useEffect, useRef } from "react";
import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// A thin paper-coloured ink stroke of the time-domain waveform, drawn *across
// the image itself* rather than in the chrome bottom strip. Alpha gated by RMS
// so it's nearly invisible at silence and rises to ~35% during loud passages.
// Visually links the audio you hear to the image you see, without competing
// with either.
const ALPHA_FLOOR = 0.0;
const ALPHA_CEIL = 0.35;

export function CanvasOscilloscope() {
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

    let buf: Uint8Array<ArrayBuffer> | null = null;
    const paperColor = "rgba(237, 231, 217, 1)";

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getCurrentAudioEngine();
      const analyser = engine?.getAnalyser() ?? null;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (w === 0 || h === 0) return;

      ctx.clearRect(0, 0, w, h);
      if (!analyser) return;

      const bins = analyser.fftSize;
      if (!buf || buf.length !== bins) {
        buf = new Uint8Array(new ArrayBuffer(bins));
      }
      analyser.getByteTimeDomainData(buf);

      // RMS of the buffer (same formula as WaveformRibbon / analyzer for
      // consistency). Gates the overall alpha so silent sections stay quiet.
      let sumSq = 0;
      for (let i = 0; i < bins; i++) {
        const d = (buf[i] ?? 128) - 128;
        sumSq += d * d;
      }
      const rms = Math.sqrt(sumSq / bins) / 128;
      const alpha =
        ALPHA_FLOOR +
        (ALPHA_CEIL - ALPHA_FLOOR) * Math.min(1, rms * 2.4);
      if (alpha < 0.01) return;

      ctx.globalAlpha = alpha;
      ctx.strokeStyle = paperColor;
      ctx.lineWidth = 0.75;
      ctx.lineJoin = "round";
      ctx.beginPath();
      const slice = w / bins;
      const midY = h / 2;
      // Amplitude envelope kept gentle — the point is presence, not DAW graph.
      const ampY = (h / 2) * 0.42;
      for (let i = 0; i < bins; i++) {
        const v = ((buf[i] ?? 128) - 128) / 128;
        const y = midY + v * ampY;
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
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ mixBlendMode: "screen" }}
    />
  );
}
