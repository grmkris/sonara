"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

import type { StageFeedRing } from "@/lib/stage/use-stage-feed";
import { cn } from "@/lib/utils";

// On-chain activity per second as a hairline ink trace — the room's pulse.
// Reads the feed's mutable ring at RAF (no React state, no re-renders),
// scrolling continuously left with a sub-second offset; bursts (≥ BURST_AT
// events in one second) strike a signal-red vertical tick, echoing the
// AudioRibbon's transient vocabulary. DPR-aware like audio-ribbon.tsx.

const RING_SECONDS = 60;
const BURST_AT = 8;
const Y_MAX = 16;

export const Seismograph = ({
  className,
  height = 24,
  ring,
}: {
  className?: string;
  height?: number;
  ring: RefObject<StageFeedRing>;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      ctx.clearRect(0, 0, w, h);

      // Baseline — hairline @ 18%, same substrate alpha as the audio ribbon.
      ctx.strokeStyle = "rgba(201, 192, 174, 0.18)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - 0.5);
      ctx.lineTo(w, h - 0.5);
      ctx.stroke();

      const state = ring.current;
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const bucketW = w / RING_SECONDS;
      // Sub-second offset scrolls the trace continuously instead of jumping
      // once a second.
      const offset = ((nowMs % 1000) / 1000) * bucketW;

      const countAt = (secsAgo: number): number => {
        const sec = nowSec - secsAgo;
        // Stale buckets (no write since) read as 0.
        if (sec > state.lastSec) {
          return 0;
        }
        return (
          state.counts[((sec % RING_SECONDS) + RING_SECONDS) % RING_SECONDS] ??
          0
        );
      };

      const yFor = (count: number): number =>
        h - 1 - Math.sqrt(Math.min(count, Y_MAX) / Y_MAX) * (h - 4);

      // Ink trace, right edge = now.
      ctx.strokeStyle = "rgba(237, 231, 217, 0.85)";
      ctx.beginPath();
      for (let i = RING_SECONDS - 1; i >= 0; i -= 1) {
        const x = w - offset - i * bucketW;
        const y = yFor(countAt(i));
        if (i === RING_SECONDS - 1) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Burst ticks in signal red.
      ctx.strokeStyle = "rgba(164, 52, 58, 0.45)";
      for (let i = RING_SECONDS - 1; i >= 0; i -= 1) {
        if (countAt(i) >= BURST_AT) {
          const x = w - offset - i * bucketW;
          ctx.beginPath();
          ctx.moveTo(x, 2);
          ctx.lineTo(x, h - 2);
          ctx.stroke();
        }
      }
    };

    // Reduced motion: a 1Hz redraw without the sub-second scroll is enough.
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    let raf = 0;
    let interval: ReturnType<typeof setInterval> | null = null;
    if (reduced) {
      draw();
      interval = setInterval(draw, 1000);
    } else {
      const loop = () => {
        draw();
        raf = requestAnimationFrame(loop);
      };
      raf = requestAnimationFrame(loop);
    }

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [ring]);

  return (
    <canvas
      aria-hidden
      className={cn("block w-full", className)}
      ref={canvasRef}
      style={{ height }}
    />
  );
};
