"use client";

import { useEffect, useRef } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

// Sumi-ink peak-hold overlay. On each RMS peak (detected as a rising local
// maximum on a short window), spawn a soft radial blob that spreads and fades
// over ~2 s. Up to MAX_DROPS concurrent; oldest drops first.
//
// Position: seeded by current spectral centroid. Low centroid (bass-heavy) →
// left; high centroid (bright) → right. Vertical position is audio-derived
// from bass vs treble balance.

const MAX_DROPS = 6;
const LIFE_MS = 2200;
const PEAK_HOLD_MS = 300; // minimum time between spawns
const PEAK_DELTA = 0.12; // minimum rise in RMS vs recent trailing avg

interface Drop {
  x: number; // 0..1
  y: number; // 0..1
  strength: number; // 0..1, shapes radius + opacity
  born: number; // performance.now()
  tint: number; // 0..1, bias from paper (0) to indigo (1)
}

export function InkDrops() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dropsRef = useRef<Drop[]>([]);
  const trailingAvgRef = useRef(0);
  const lastSpawnRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) {
      return;
    }

    let rafId = 0;

    function resize() {
      if (!canvas) {
        return;
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    }

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    resize();

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      if (!canvas) {
        return;
      }
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) {
        return;
      }
      resize();

      const state = useVisualizerStore.getState();
      const { audio } = state;
      const { intensity } = state.scene;
      const now = performance.now();

      // Peak detection on RMS — rising above the trailing EMA by PEAK_DELTA.
      const trailing = trailingAvgRef.current;
      trailingAvgRef.current = trailing * 0.94 + audio.rms * 0.06;
      if (
        audio.rms - trailing > PEAK_DELTA &&
        now - lastSpawnRef.current > PEAK_HOLD_MS &&
        intensity > 0.05
      ) {
        lastSpawnRef.current = now;
        // Position: centroid drives X (0..1); bass-vs-treble balance drives Y.
        const x = 0.1 + audio.centroid * 0.8 + (Math.random() - 0.5) * 0.1;
        const bassness = audio.bass / Math.max(0.01, audio.bass + audio.treble);
        const y = 0.25 + bassness * 0.5 + (Math.random() - 0.5) * 0.12;
        const drop: Drop = {
          born: now,
          strength: Math.min(1, audio.rms * 1.4),
          tint: audio.centroid,
          x,
          y,
        };
        const drops = dropsRef.current;
        drops.push(drop);
        while (drops.length > MAX_DROPS) {
          drops.shift();
        }
      }

      // Render.
      ctx.clearRect(0, 0, w, h);
      const drops = dropsRef.current;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        if (!d) {
          continue;
        }
        const age = now - d.born;
        if (age > LIFE_MS) {
          drops.splice(i, 1);
          continue;
        }
        const t = age / LIFE_MS; // 0..1
        const radius = 20 + t * 180 * d.strength;
        // Opacity: rises fast, fades slow. Peaks around 15% life.
        const a =
          t < 0.15
            ? (t / 0.15) * 0.35
            : 0.35 * Math.max(0, 1 - (t - 0.15) / 0.85);
        const cx = d.x * w;
        const cy = d.y * h;

        // Tint: blend warm stone (low tint) ↔ indigo (high tint). Muted,
        // multiply-blended onto the image. Signal red is reserved for the
        // commit stamp and must not appear in ambient drops.
        const r = Math.round(lerp(140, 28, d.tint));
        const g = Math.round(lerp(133, 45, d.tint));
        const b = Math.round(lerp(120, 82, d.tint));

        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        grad.addColorStop(
          0,
          `rgba(${r},${g},${b},${(a * d.strength * intensity).toFixed(3)})`
        );
        grad.addColorStop(
          0.6,
          `rgba(${r},${g},${b},${(a * 0.35 * intensity).toFixed(3)})`
        );
        grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full mix-blend-multiply"
      style={{ willChange: "contents" }}
    />
  );
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
