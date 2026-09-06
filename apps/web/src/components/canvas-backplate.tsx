"use client";

import { useEffect, useRef } from "react";

import type { InstrumentRuntime } from "@/lib/instrument/runtime";

// A quiet preview of the listening material. It owns no audio, session, or
// playback source, so browsing the landing page cannot change a running show.
export const CanvasBackplate = () => {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const element = canvas.current;
    if (!element) {
      return;
    }
    let disposed = false;
    let raf = 0;
    let runtime: InstrumentRuntime | null = null;
    const start = async () => {
      try {
        const { InstrumentRuntime: Runtime } =
          await import("@/lib/instrument/runtime");
        if (disposed) {
          return;
        }
        runtime = new Runtime(element);
        await runtime.init();
        if (disposed) {
          runtime.dispose();
          return;
        }
        let last = 0;
        const origin = performance.now();
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        const tick = (now: number) => {
          if (disposed || !runtime) {
            return;
          }
          if (!document.hidden && now - last > 1000 / 30) {
            last = now;
            const rect = element.getBoundingClientRect();
            runtime.renderer.resize(
              Math.min(1280, rect.width),
              (Math.min(1280, rect.width) * rect.height) / rect.width
            );
            runtime.advance((now - origin) / 1000);
          }
          if (!reduced) {
            raf = requestAnimationFrame(tick);
          }
        };
        tick(performance.now());
      } catch {
        // The CSS backdrop remains available when graphics cannot initialize.
      }
    };
    void start();
    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      runtime?.dispose();
    };
  }, []);
  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(ellipse_at_center,#251a28,#080809_70%)]">
        <canvas ref={canvas} aria-hidden className="h-full w-full" />
      </div>
      <div aria-hidden className="grain-overlay" />
      <div
        aria-hidden
        className="page-veil pointer-events-none fixed inset-0 z-[2]"
      />
    </>
  );
};
