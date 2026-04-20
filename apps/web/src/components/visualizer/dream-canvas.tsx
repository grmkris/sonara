"use client";

import { useEffect, useRef } from "react";
import {
  markImageLoaded,
  useVisualizerStore,
} from "@/stores/visualizer-store";
import {
  intensityCoefficients,
  targetsFromAudio,
} from "@/lib/render/map-audio-to-visuals";
import { createVuEnvelope, type VuEnvelope } from "@/lib/render/vu";
import { CanvasGrain } from "@/components/visualizer/canvas-grain";
import { OnsetRing } from "@/components/visualizer/onset-ring";
import { InkDrops } from "@/components/visualizer/ink-drops";

const BLEED_MS = 1400;
const FADE_MS = 640;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface EnvelopeBundle {
  rms: VuEnvelope;
  bass: VuEnvelope;
  mids: VuEnvelope;
  treble: VuEnvelope;
  palette: VuEnvelope;
}

function buildEnvelopes(intensity: number): EnvelopeBundle {
  const c = intensityCoefficients(intensity);
  const base = {
    attackMs: c.vuAttackMs,
    releaseMs: c.vuReleaseMs,
    peakAttackMs: 10,
    peakReleaseMs: 1500,
    overshoot: c.peakOvershoot,
  } as const;
  return {
    rms: createVuEnvelope(base),
    bass: createVuEnvelope(base),
    mids: createVuEnvelope(base),
    treble: createVuEnvelope(base),
    // Palette moves slower — keep it smooth even at high intensity.
    palette: createVuEnvelope({
      attackMs: Math.max(800, c.vuAttackMs * 3),
      releaseMs: Math.max(2000, c.vuReleaseMs * 2),
      peakAttackMs: 200,
      peakReleaseMs: 3000,
      overshoot: 0,
    }),
  };
}

export function DreamCanvas() {
  const prevImgRef = useRef<HTMLImageElement | null>(null);
  const currImgRef = useRef<HTMLImageElement | null>(null);
  const driftStartRef = useRef<number>(performance.now());
  const lastTickRef = useRef<number>(performance.now());
  const lastIntensityRef = useRef<number>(-1);
  const envelopesRef = useRef<EnvelopeBundle | null>(null);
  const lastOnsetRef = useRef(false);

  // Per-onset-type short-lived impulse envelopes (0..1, decays toward 0).
  const impulseRef = useRef({
    kick: 0,
    snare: 0,
    hat: 0,
    vocal: 0,
  });

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
      // Rebuild envelopes when intensity changes meaningfully (avoids rebuild
      // on every 0.01-step slider drag).
      if (
        envelopesRef.current === null ||
        Math.abs(intensity - lastIntensityRef.current) > 0.03
      ) {
        envelopesRef.current = buildEnvelopes(intensity);
        lastIntensityRef.current = intensity;
      }
      const env = envelopesRef.current;

      const targets = targetsFromAudio(state.audio, intensity);
      const coef = intensityCoefficients(intensity);

      // Feed VU envelopes with the per-band audio levels (not the target
      // values) so each envelope can expose its own value + peak.
      env.rms.update(state.audio.rms, dtMs);
      env.bass.update(state.audio.bass, dtMs);
      env.mids.update(state.audio.mids, dtMs);
      env.treble.update(state.audio.treble, dtMs);
      env.palette.update(state.audio.centroid, dtMs);

      // Onset-type impulse routing. Rising edge only.
      const imp = impulseRef.current;
      const risingOnset = state.audio.onset && !lastOnsetRef.current;
      lastOnsetRef.current = state.audio.onset;
      if (risingOnset) {
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
      // Impulses decay ~300 ms half-life; taut at high intensity, slack at low.
      const halfLife = 300 - 150 * intensity;
      const decay = Math.exp(-dtMs / Math.max(40, halfLife));
      imp.kick *= decay;
      imp.snare *= decay;
      imp.hat *= decay;
      imp.vocal *= decay;

      // Compose the final look from VU values + impulse channels.
      const kickBoost = imp.kick * coef.zoomImpulseGain;
      const vocalBoost = imp.vocal * coef.onsetImpulseGain * 0.35;
      const hatBoost = imp.hat * coef.grainSwellGain * 0.6;
      const snareFlash = imp.snare; // 0..1 drives contrast/saturation briefly

      const zoomVu = targets.zoom + env.bass.peak * 0.04 * intensity;
      const zoomLevel = zoomVu + kickBoost * 0.035;

      const bloomLevel =
        0.15 + env.rms.value * 0.9 + vocalBoost + env.rms.peak * 0.25 * intensity;

      const warpLevel = env.bass.value * 0.6 + env.mids.value * 0.25;
      const blurLevel = Math.max(0, 0.25 - env.treble.value * 0.18);

      const huePumpNorm = coef.huePumpRange / 18;
      const paletteShift = (env.palette.value * 2 - 1) * huePumpNorm; // -huePumpNorm..+huePumpNorm

      // Time-based drifts preserved from prior design.
      const driftT = (now - driftStartRef.current) / 1000;
      const slowPan = Math.sin(driftT * 0.05) * 12;
      const slowYaw = Math.cos(driftT * 0.07) * 1.2;
      const breath = 1 + Math.sin(driftT * 0.2) * 0.008;

      // Kick-onset jitter: small translate offset scaled by intensity.
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

      // CSS filter composition. Snare fires a brief contrast/saturation flip
      // (posterize-adjacent, CSS-only).
      const contrastBoost = 1 + warpLevel * 0.25 + snareFlash * 0.8;
      const saturateBoost =
        1 + env.rms.value * 0.4 - snareFlash * 0.7; // snare desaturates toward wood-block
      const brightnessBoost = 1 + bloomLevel * 0.9;

      const filter = `blur(${(blurLevel * 2).toFixed(2)}rem) brightness(${brightnessBoost.toFixed(3)}) contrast(${contrastBoost.toFixed(3)}) saturate(${Math.max(0.15, saturateBoost).toFixed(3)}) hue-rotate(${(paletteShift * 360).toFixed(2)}deg)`;

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

      // Expose a snapshot to the grain+ink-drop overlays via dataset so they
      // don't need a second rAF loop.
      const host = prevImg?.parentElement ?? currImg?.parentElement;
      if (host) {
        host.style.setProperty("--grain-amp", String((targets.grainSwell + hatBoost).toFixed(3)));
        host.style.setProperty("--vignette-amp", String(targets.vignette.toFixed(3)));
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
      <InkDrops />
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
