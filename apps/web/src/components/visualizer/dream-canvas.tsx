"use client";

import { useEffect, useRef, useState } from "react";
import {
  markImageLoaded,
  useVisualizerStore,
} from "@/stores/visualizer-store";
import {
  intensityCoefficients,
  targetsFromAudio,
} from "@/lib/render/map-audio-to-visuals";
import { createVuEnvelope, type VuEnvelope } from "@/lib/render/vu";
import { isWebgl2Available } from "@/lib/render/webgl-util";
import { CanvasGrain } from "@/components/visualizer/canvas-grain";
import { InkDrops } from "@/components/visualizer/ink-drops";
import { DisplacementCanvas } from "@/components/visualizer/displacement-canvas";
import { CanvasOscilloscope } from "@/components/visualizer/canvas-oscilloscope";

// Top-level wrapper. Picks a renderer at mount: WebGL2 + motion OK → displacement
// shader, otherwise the original <img>+CSS-filter path. Overlays (grain, onset
// rings, ink drops, vignette) are composited over whichever renderer wins.
export function DreamCanvas() {
  const [mode, setMode] = useState<"css" | "gl">("css");

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduced && isWebgl2Available()) setMode("gl");
  }, []);

  return (
    <div
      className="absolute inset-0 overflow-hidden bg-[color:var(--ink)]"
      style={{ isolation: "isolate" }}
    >
      <EmptyIdeogram />
      {mode === "gl" ? <DisplacementCanvas /> : <CssFrames />}
      <CanvasGrain />
      <InkDrops />
      <CanvasOscilloscope />
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
        className="font-serif breath text-[color:var(--paper)] select-none italic tracking-tight"
        style={{ fontSize: "16vmin", fontWeight: 500, lineHeight: 1 }}
      >
        dream
      </span>
    </div>
  );
}

// ————————————————————————————————————————————————————————————————————
// CSS fallback renderer. Two <img> layers + per-frame CSS filter/transform
// updates. Preserved for browsers without WebGL2 or prefers-reduced-motion.
// ————————————————————————————————————————————————————————————————————

const BLEED_MS = 4500;
const FADE_MS = 1500;

interface EnvelopeBundle {
  rms: VuEnvelope;
  bass: VuEnvelope;
  mids: VuEnvelope;
  treble: VuEnvelope;
  palette: VuEnvelope;
}

// Carry prior value/peak so intensity-driven rebuilds don't snap to 0.
function buildEnvelopes(
  intensity: number,
  prev?: EnvelopeBundle,
): EnvelopeBundle {
  const c = intensityCoefficients(intensity);
  const make = (p?: VuEnvelope) =>
    createVuEnvelope({
      attackMs: c.vuAttackMs,
      releaseMs: c.vuReleaseMs,
      peakAttackMs: 10,
      peakReleaseMs: 1500,
      overshoot: c.peakOvershoot,
      initialValue: p?.value,
      initialPeak: p?.peak,
    });
  return {
    rms: make(prev?.rms),
    bass: make(prev?.bass),
    mids: make(prev?.mids),
    treble: make(prev?.treble),
    palette: createVuEnvelope({
      attackMs: Math.max(800, c.vuAttackMs * 3),
      releaseMs: Math.max(2000, c.vuReleaseMs * 2),
      peakAttackMs: 200,
      peakReleaseMs: 3000,
      overshoot: 0,
      initialValue: prev?.palette.value,
      initialPeak: prev?.palette.peak,
    }),
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function CssFrames() {
  const prevImgRef = useRef<HTMLImageElement | null>(null);
  const currImgRef = useRef<HTMLImageElement | null>(null);
  const driftStartRef = useRef<number>(performance.now());
  const lastTickRef = useRef<number>(performance.now());
  const lastIntensityRef = useRef<number>(-1);
  const envelopesRef = useRef<EnvelopeBundle | null>(null);
  const lastOnsetRef = useRef(false);
  const impulseRef = useRef({ kick: 0, snare: 0, hat: 0, vocal: 0 });

  useEffect(() => {
    const store = useVisualizerStore;
    const reducedMotion = prefersReducedMotion();
    let rafId = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const state = store.getState();
      const prevImg = prevImgRef.current;
      const currImg = currImgRef.current;

      const now = performance.now();
      const dtMs = Math.max(1, now - lastTickRef.current);
      lastTickRef.current = now;

      const intensity = state.scene.intensity;
      if (
        envelopesRef.current === null ||
        Math.abs(intensity - lastIntensityRef.current) > 0.03
      ) {
        envelopesRef.current = buildEnvelopes(
          intensity,
          envelopesRef.current ?? undefined,
        );
        lastIntensityRef.current = intensity;
      }
      const env = envelopesRef.current;

      const targets = targetsFromAudio(state.audio, intensity);
      const coef = intensityCoefficients(intensity);

      env.rms.update(state.audio.rms, dtMs);
      env.bass.update(state.audio.bass, dtMs);
      env.mids.update(state.audio.mids, dtMs);
      env.treble.update(state.audio.treble, dtMs);
      env.palette.update(state.audio.centroid, dtMs);

      // Onset-type impulse routing, rising edge only.
      const imp = impulseRef.current;
      const rising = state.audio.onset && !lastOnsetRef.current;
      lastOnsetRef.current = state.audio.onset;
      if (rising) {
        switch (state.audio.onsetType) {
          case "kick":
            imp.kick = 1;
            break;
          case "snare":
            imp.snare = 1;
            break;
          case "hat":
            imp.hat = 1;
            break;
          case "vocal":
            imp.vocal = 1;
            break;
          default:
            break;
        }
      }
      const halfLife = 300 - 150 * intensity;
      const decay = Math.exp(-dtMs / Math.max(40, halfLife));
      imp.kick *= decay;
      imp.snare *= decay;
      imp.hat *= decay;
      imp.vocal *= decay;

      const kickBoost = imp.kick * coef.zoomImpulseGain;
      const vocalBoost = imp.vocal * coef.onsetImpulseGain * 0.35;
      const snareFlash = imp.snare;

      const zoomVu = (targets.zoom ?? 1) + env.bass.peak * 0.04 * intensity;
      const zoomLevel = zoomVu + kickBoost * 0.035;

      // Bloom ceiling tightened so loud sections don't blow highlights to
      // rainbow wash. Compressed multiplier further caps brightness at ~1.30.
      const bloomLevelRaw =
        0.05 + env.rms.value * 0.55 + vocalBoost + env.rms.peak * 0.15 * intensity;
      const bloomLevel = Math.min(0.55, bloomLevelRaw);

      const warpLevel = env.bass.value * 0.6 + env.mids.value * 0.25;
      // Blur target from map-audio sits at 0 by default; we additionally cap
      // the damped value to avoid the legacy "always blurred" starting state.
      const blurTarget = Math.max(0, targets.blur ?? 0);

      const huePumpNorm = coef.huePumpRange / 18;
      const paletteShift = (env.palette.value * 2 - 1) * huePumpNorm;

      const driftT = (now - driftStartRef.current) / 1000;
      const slowPan = Math.sin(driftT * 0.05) * 12;
      const slowYaw = Math.cos(driftT * 0.07) * 1.2;
      const breath = 1 + Math.sin(driftT * 0.2) * 0.008;

      const jitter = kickBoost * 6;
      const jitterX = jitter * (Math.random() - 0.5);
      const jitterY = jitter * (Math.random() - 0.5);

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

      const contrastBoost = 1 + warpLevel * 0.25 + snareFlash * 0.8;
      const saturateBoost = 1 + env.rms.value * 0.4 - snareFlash * 0.7;
      const brightnessBoost = 1 + Math.min(0.3, bloomLevel * 0.6);

      const filter = `blur(${(blurTarget * 2).toFixed(2)}rem) brightness(${brightnessBoost.toFixed(3)}) contrast(${contrastBoost.toFixed(3)}) saturate(${Math.max(0.15, saturateBoost).toFixed(3)}) hue-rotate(${(paletteShift * 360).toFixed(2)}deg)`;

      const transform = `scale(${(zoomLevel * breath).toFixed(4)}) translate3d(${(slowPan + jitterX).toFixed(2)}px, ${(-slowPan * 0.4 + jitterY).toFixed(2)}px, 0) rotate(${slowYaw.toFixed(3)}deg)`;

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
    <>
      <FrameLayer ref={prevImgRef} selector={(s) => s.previousFrame} />
      <FrameLayer
        ref={currImgRef}
        selector={(s) => s.currentFrame}
        onLoad={markImageLoaded}
      />
    </>
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
