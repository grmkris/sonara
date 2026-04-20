"use client";

import { useEffect, useRef } from "react";
import {
  markImageLoaded,
  useVisualizerStore,
} from "@/stores/visualizer-store";
import { damp } from "@/lib/render/damp";
import { targetsFromAudio } from "@/lib/render/map-audio-to-visuals";
import { CanvasGrain } from "@/components/visualizer/canvas-grain";
import { OnsetRing } from "@/components/visualizer/onset-ring";

// Duration (ms) of the ink-bleed reveal when a new frame arrives on top of a
// previous one. First-frame loads use the shorter fade instead.
const BLEED_MS = 1400;
const FADE_MS = 640;

// Damping factors per feature. Higher = more audio-reactive, lower = smoother.
// Tuned so kick drums register without the image thrashing.
const DAMP_ZOOM = 0.15;
const DAMP_BLOOM = 0.12;
const DAMP_WARP = 0.05;
const DAMP_BLUR = 0.08;
const DAMP_PALETTE = 0.02;
const DAMP_IMPULSE_DECAY = 0.35;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function DreamCanvas() {
  const prevImgRef = useRef<HTMLImageElement | null>(null);
  const currImgRef = useRef<HTMLImageElement | null>(null);
  const driftStartRef = useRef<number>(performance.now());
  const renderStateRef = useRef({
    zoom: 1,
    bloom: 0.15,
    warp: 0,
    blur: 0.15,
    paletteShift: 0,
    impulse: 0,
  });
  const lastOnsetRef = useRef(false);

  useEffect(() => {
    const store = useVisualizerStore;
    const reducedMotion = prefersReducedMotion();
    let rafId = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const state = store.getState();
      const prevImg = prevImgRef.current;
      const currImg = currImgRef.current;

      const targets = targetsFromAudio(state.audio);
      const r = renderStateRef.current;
      r.zoom = damp(r.zoom, targets.zoom ?? 1, DAMP_ZOOM);
      r.bloom = damp(r.bloom, targets.bloom ?? 0.15, DAMP_BLOOM);
      r.warp = damp(r.warp, targets.warp ?? 0, DAMP_WARP);
      r.blur = damp(r.blur, targets.blur ?? 0.15, DAMP_BLUR);
      r.paletteShift = damp(r.paletteShift, targets.paletteShift ?? 0, DAMP_PALETTE);

      // Rising-edge onset detection → impulse = 1, decays toward 0 each frame.
      if (state.audio.onset && !lastOnsetRef.current) r.impulse = 1;
      else r.impulse = damp(r.impulse, 0, DAMP_IMPULSE_DECAY);
      lastOnsetRef.current = state.audio.onset;

      const motion = targets.motionEnergy ?? 0;
      // Pulse amplitude is gated by motionEnergy: a beat in a quiet section
      // nudges the canvas; a beat in a loud one shoves it.
      const beat = r.impulse * (0.05 + motion * 0.35);

      const now = performance.now();
      const driftT = (now - driftStartRef.current) / 1000;
      const slowPan = Math.sin(driftT * 0.05) * 12;
      const slowYaw = Math.cos(driftT * 0.07) * 1.2;
      const breath = 1 + Math.sin(driftT * 0.2) * 0.008;

      // Reveal timing. When both frames are present we paint a radial ink-bleed;
      // otherwise we fall back to a simple opacity fade.
      const hasPrev = state.previousFrame !== null;
      const t =
        state.crossfadeStartedAt === null
          ? state.currentFrame
            ? 1
            : 0
          : Math.min(
              1,
              (now - state.crossfadeStartedAt) / (hasPrev ? BLEED_MS : FADE_MS),
            );

      const useBleed = hasPrev && !reducedMotion;

      const filter = `blur(${(r.blur * 2).toFixed(2)}rem) brightness(${(1 + r.bloom * 0.9 + beat).toFixed(3)}) contrast(${(1 + r.warp * 0.25).toFixed(3)}) saturate(${(1 + r.bloom * 0.4).toFixed(3)}) hue-rotate(${(r.paletteShift * 360).toFixed(2)}deg)`;
      const transform = `scale(${(r.zoom * breath).toFixed(4)}) translate3d(${slowPan.toFixed(2)}px, ${(-slowPan * 0.4).toFixed(2)}px, 0) rotate(${slowYaw.toFixed(3)}deg)`;

      if (currImg) {
        currImg.style.filter = filter;
        currImg.style.transform = transform;
        if (useBleed) {
          const pct = t * 100;
          currImg.style.opacity = "1";
          currImg.style.maskImage = `radial-gradient(circle at 50% 50%, rgba(0,0,0,1) ${pct}%, rgba(0,0,0,0) ${Math.min(130, pct + 30)}%)`;
          currImg.style.webkitMaskImage = currImg.style.maskImage;
        } else {
          currImg.style.opacity = String(t);
          currImg.style.maskImage = "none";
          currImg.style.webkitMaskImage = "none";
        }
      }
      if (prevImg) {
        // Previous stays fully visible behind the bleed and is retired once the
        // reveal completes. With no bleed, it fades out opposite the current.
        if (useBleed) prevImg.style.opacity = t >= 1 ? "0" : "1";
        else prevImg.style.opacity = String(1 - t);
        prevImg.style.filter = filter;
        prevImg.style.transform = transform;
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[color:var(--ink)]"
      style={{ isolation: "isolate" }}
    >
      <EmptyIdeogram />
      <FrameLayer ref={prevImgRef} selector={(s) => s.previousFrame} />
      <FrameLayer
        ref={currImgRef}
        selector={(s) => s.currentFrame}
        onLoad={markImageLoaded}
      />
      <CanvasGrain />
      <OnsetRing />
      <div aria-hidden className="vignette-mask absolute inset-0" />
    </div>
  );
}

function EmptyIdeogram() {
  const hasFrame = useVisualizerStore(
    (s) => s.currentFrame !== null || s.previousFrame !== null,
  );
  if (hasFrame) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <span
        aria-hidden
        className="font-mincho breath text-[color:var(--paper)] select-none"
        style={{ fontSize: "22vmin", fontWeight: 500, lineHeight: 1 }}
      >
        夢
      </span>
    </div>
  );
}

interface FrameLayerProps {
  ref: React.Ref<HTMLImageElement | null>;
  selector: (
    s: ReturnType<typeof useVisualizerStore.getState>,
  ) => string | null;
  onLoad?: () => void;
}

function FrameLayer({ ref, selector, onLoad }: FrameLayerProps) {
  const url = useVisualizerStore(selector);
  if (!url) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={ref}
      src={url}
      alt=""
      onLoad={onLoad}
      className="pointer-events-none absolute inset-0 h-full w-full object-cover"
      style={{
        opacity: 0,
        transition: "none",
        willChange: "opacity, filter, transform, mask-image",
      }}
    />
  );
}
