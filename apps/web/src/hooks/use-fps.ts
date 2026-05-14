"use client";

import { useEffect, useState } from "react";

// Live FPS readout, revealed at 1 Hz. Avoids per-frame re-render by
// EMA-smoothing inside RAF and only setState'ing once a second.
export function useFps(): number {
  const [fps, setFps] = useState(60);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let raf = 0;
    let last = performance.now();
    let ema = 60;
    let revealTimer: number;

    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (dt > 0) {
        const sample = 1000 / dt;
        // 0.85 old / 0.15 new — fast enough to react to dips, slow enough
        // not to jitter on idle frames.
        ema = ema * 0.85 + sample * 0.15;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    revealTimer = window.setInterval(() => {
      setFps(Math.round(ema));
    }, 1000);

    return () => {
      cancelAnimationFrame(raf);
      window.clearInterval(revealTimer);
    };
  }, []);

  return fps;
}
