"use client";

import { useEffect, useRef } from "react";

import { getCurrentAudioEngine } from "@/hooks/use-audio-features";

// Seismograph on graph paper. A faint horizontal hairline grid drawn once
// per resize forms the substrate; a 1px paper-coloured trace plots the
// waveform on top; transient events spike a signal-red vertical hairline
// that decays over a handful of frames. Reads the AnalyserNode directly
// at 60Hz (no store round-trip).

const GRID_STEP_Y = 8; // px between horizontal grid lines
const GRID_STEP_X = 60; // px between vertical grid lines
const STROKE_ALPHA_MIN = 0.18;
const STROKE_ALPHA_MAX = 0.85;
const TRANSIENT_THRESHOLD = 0.085; // RMS jump that counts as a "tick"
const TICK_DECAY_FRAMES = 6;

interface AudioRibbonProps {
  height?: number;
}

interface Tick {
  x: number;
  life: number;
}

export function AudioRibbon({ height = 40 }: AudioRibbonProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gridRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }

    // Off-screen graph-paper texture so we don't redraw the grid on every
    // animation frame — only when the canvas resizes.
    const grid = document.createElement("canvas");
    gridRef.current = grid;
    const gridCtx = grid.getContext("2d");
    if (!gridCtx) {
      return;
    }

    const drawGrid = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth: w, clientHeight: h } = canvas;
      grid.width = Math.floor(w * dpr);
      grid.height = Math.floor(h * dpr);
      gridCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gridCtx.clearRect(0, 0, w, h);
      gridCtx.strokeStyle = "rgba(201, 192, 174, 0.18)"; // --hairline @ 18 %
      gridCtx.lineWidth = 1;
      // Horizontal rules
      for (let y = GRID_STEP_Y; y < h; y += GRID_STEP_Y) {
        gridCtx.beginPath();
        gridCtx.moveTo(0, y + 0.5);
        gridCtx.lineTo(w, y + 0.5);
        gridCtx.stroke();
      }
      // Vertical rules, slightly fainter
      gridCtx.strokeStyle = "rgba(201, 192, 174, 0.10)";
      for (let x = GRID_STEP_X; x < w; x += GRID_STEP_X) {
        gridCtx.beginPath();
        gridCtx.moveTo(x + 0.5, 0);
        gridCtx.lineTo(x + 0.5, h);
        gridCtx.stroke();
      }
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = canvas;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }
      canvas.width = Math.floor(clientWidth * dpr);
      canvas.height = Math.floor(clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawGrid();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let waveBuf: Uint8Array<ArrayBuffer> | null = null;
    const paperStroke = "rgba(237, 231, 217, 1)"; // --paper literal
    const tickStroke = "rgba(164, 52, 58, 0.45)"; // --signal @ 45 %
    let lastRms = 0;
    const ticks: Tick[] = [];

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const engine = getCurrentAudioEngine();
      const analyser = engine?.getAnalyser() ?? null;
      const { clientWidth: w, clientHeight: h } = canvas;
      if (w === 0 || h === 0) {
        return;
      }

      ctx.clearRect(0, 0, w, h);

      // Substrate: graph-paper grid.
      ctx.drawImage(grid, 0, 0, grid.width, grid.height, 0, 0, w, h);

      if (!analyser) {
        // Idle: faint baseline rule across the centre, no trace.
        ctx.globalAlpha = STROKE_ALPHA_MIN;
        ctx.strokeStyle = paperStroke;
        ctx.lineWidth = 0.75;
        ctx.beginPath();
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        return;
      }

      const waveBins = analyser.fftSize;
      if (!waveBuf || waveBuf.length !== waveBins) {
        waveBuf = new Uint8Array(new ArrayBuffer(waveBins));
      }
      analyser.getByteTimeDomainData(waveBuf);

      // RMS for alpha modulation + transient detection.
      let sum = 0;
      for (let i = 0; i < waveBins; i++) {
        const d = (waveBuf[i] ?? 128) - 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / waveBins) / 128;
      const alpha =
        STROKE_ALPHA_MIN +
        (STROKE_ALPHA_MAX - STROKE_ALPHA_MIN) * Math.min(1, rms * 2.4);

      if (rms - lastRms > TRANSIENT_THRESHOLD) {
        ticks.push({ life: TICK_DECAY_FRAMES, x: w - 1 });
      }
      lastRms = rms;

      // Pen-plotter trace.
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = paperStroke;
      ctx.lineWidth = 1;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      const slice = w / waveBins;
      for (let i = 0; i < waveBins; i++) {
        const v = ((waveBuf[i] ?? 128) - 128) / 128; // -1..1
        const y = h / 2 + v * (h / 2) * 0.78;
        const x = i * slice;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();

      // Event ticks — decaying vertical signal-red rules.
      ctx.strokeStyle = tickStroke;
      ctx.lineWidth = 1;
      for (let i = ticks.length - 1; i >= 0; i--) {
        const t = ticks[i];
        if (!t) {
          continue;
        }
        ctx.globalAlpha = (t.life / TICK_DECAY_FRAMES) * 0.6;
        ctx.beginPath();
        ctx.moveTo(t.x + 0.5, 0);
        ctx.lineTo(t.x + 0.5, h);
        ctx.stroke();
        t.life--;
        if (t.life <= 0) {
          ticks.splice(i, 1);
        }
      }
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
