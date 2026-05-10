"use client";

import { useEffect, useRef } from "react";
import { getCurrentDisplacementCanvas } from "@/components/visualizer/canvas/displacement-canvas";
import { useVisualizerStore } from "@/stores/visualizer-store";

// Time-compressed echo ribbon pinned above the bottom audio strip. Every
// SAMPLE_MS, grabs the current WebGL canvas frame and draws it into a
// SAMPLE_PX-wide slice at the right edge of this strip, shifting the strip
// left. Over time the strip becomes a scrolling "scroll" of the last ~8s of
// visuals — a quiet, contemplative memory of what just happened.
//
// Uses Canvas 2D drawImage from the WebGL canvas (which is efficient in modern
// browsers — no pixel readback required, just a GPU texture blit).
const SAMPLE_MS = 80;
const SAMPLE_PX = 8;

export function SlitScanTrail({ height = 28 }: { height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let dpr = window.devicePixelRatio || 1;
    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) return;
      canvas.width = Math.floor(clientWidth * dpr);
      canvas.height = Math.floor(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // When we resize we lose the old content; that's acceptable — the strip
      // fills back up naturally over ~8s.
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let lastSampleAt = 0;
    let raf = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      if (now - lastSampleAt < SAMPLE_MS) return;
      lastSampleAt = now;

      // Skip sampling until the first image has actually loaded. Before
      // that the WebGL canvas clears to opaque black, and the strip would
      // fill with a solid black bar.
      if (useVisualizerStore.getState().currentFrame === null) return;

      const source = getCurrentDisplacementCanvas();
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!source || w === 0 || h === 0) return;

      // Shift existing content left by SAMPLE_PX using canvas → self blit.
      // globalCompositeOperation stays default ('source-over') but we disable
      // alpha smoothing to avoid a cumulative blur creep.
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(canvas, -SAMPLE_PX * dpr, 0);

      // Draw the new SAMPLE_PX-wide slice on the right edge.
      // Source is the entire WebGL canvas scaled into the slice.
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(source, w - SAMPLE_PX, 0, SAMPLE_PX, h);
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
      style={{ height, width: "100%", opacity: 0.72 }}
    />
  );
}
