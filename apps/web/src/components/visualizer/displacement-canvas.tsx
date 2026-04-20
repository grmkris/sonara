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
import {
  createProgram,
  createQuadBuffer,
  createShader,
  createTexture,
  resizeCanvasToDisplay,
  uploadImageToTexture,
} from "@/lib/render/webgl-util";
import {
  FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "./displacement-shaders";

const BLEED_MS = 4500;
const FADE_MS = 1500;

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
    palette: createVuEnvelope({
      attackMs: Math.max(800, c.vuAttackMs * 3),
      releaseMs: Math.max(2000, c.vuReleaseMs * 2),
      peakAttackMs: 200,
      peakReleaseMs: 3000,
      overshoot: 0,
    }),
  };
}

interface TextureSlot {
  tex: WebGLTexture;
  size: [number, number];
  loaded: boolean;
}

// Four ink-blot origins + per-blot stagger delays. Regenerated on every new
// frame so each transition looks different.
interface DropConfig {
  ab: [number, number, number, number]; // a.x, a.y, b.x, b.y
  cd: [number, number, number, number]; // c.x, c.y, d.x, d.y
  delays: [number, number, number, number];
}

function randomDrops(): DropConfig {
  const rand = () => Math.random();
  // First drop stays near centre so the primary bleed always anchors there.
  const aX = 0.5 + (rand() - 0.5) * 0.25;
  const aY = 0.5 + (rand() - 0.5) * 0.25;
  return {
    ab: [aX, aY, rand(), rand()],
    cd: [rand(), rand(), rand(), rand()],
    // Drop A starts immediately; others stagger up to ~0.45 into the transition.
    delays: [0, rand() * 0.25 + 0.05, rand() * 0.35 + 0.10, rand() * 0.40 + 0.15],
  };
}

export function DisplacementCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      antialias: false,
      alpha: false,
    });
    if (!gl) return;

    let program: WebGLProgram;
    try {
      const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fs = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      program = createProgram(gl, vs, fs);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    } catch (err) {
      console.error("[DisplacementCanvas] shader build failed:", err);
      return;
    }
    gl.useProgram(program);

    const uni = {
      uCurr: gl.getUniformLocation(program, "uCurr"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uHasPrev: gl.getUniformLocation(program, "uHasPrev"),
      uBleedT: gl.getUniformLocation(program, "uBleedT"),
      uTime: gl.getUniformLocation(program, "uTime"),
      uBass: gl.getUniformLocation(program, "uBass"),
      uMids: gl.getUniformLocation(program, "uMids"),
      uTreble: gl.getUniformLocation(program, "uTreble"),
      uRms: gl.getUniformLocation(program, "uRms"),
      uRmsPeak: gl.getUniformLocation(program, "uRmsPeak"),
      uKick: gl.getUniformLocation(program, "uKick"),
      uSnare: gl.getUniformLocation(program, "uSnare"),
      uHat: gl.getUniformLocation(program, "uHat"),
      uVocal: gl.getUniformLocation(program, "uVocal"),
      uIntensity: gl.getUniformLocation(program, "uIntensity"),
      uHuePumpNorm: gl.getUniformLocation(program, "uHuePumpNorm"),
      uPaletteShift: gl.getUniformLocation(program, "uPaletteShift"),
      uCurrTexSize: gl.getUniformLocation(program, "uCurrTexSize"),
      uPrevTexSize: gl.getUniformLocation(program, "uPrevTexSize"),
      uViewSize: gl.getUniformLocation(program, "uViewSize"),
      uImpulseAges: gl.getUniformLocation(program, "uImpulseAges"),
      uDropsAB: gl.getUniformLocation(program, "uDropsAB"),
      uDropsCD: gl.getUniformLocation(program, "uDropsCD"),
      uDropDelays: gl.getUniformLocation(program, "uDropDelays"),
    };
    // Sampler unit bindings.
    gl.uniform1i(uni.uCurr, 0);
    gl.uniform1i(uni.uPrev, 1);

    const { vao } = createQuadBuffer(gl);

    // Two texture slots rotated by flag — new image goes into the inactive
    // slot; currIsSlotA flips on successful load. Avoids an extra blit.
    const slotA: TextureSlot = {
      tex: createTexture(gl),
      size: [1, 1],
      loaded: false,
    };
    const slotB: TextureSlot = {
      tex: createTexture(gl),
      size: [1, 1],
      loaded: false,
    };
    let currIsA = true;
    const getCurr = (): TextureSlot => (currIsA ? slotA : slotB);
    const getPrev = (): TextureSlot => (currIsA ? slotB : slotA);
    const getInactive = (): TextureSlot => (currIsA ? slotB : slotA);

    // Ink-blot drop configuration — regenerated on each successful frame load.
    let drops: DropConfig = randomDrops();

    // Image loader: watches the store for currentFrame changes.
    let lastLoadedUrl: string | null = null;
    let pendingImg: HTMLImageElement | null = null;
    const unsubFrame = useVisualizerStore.subscribe((state) => {
      const url = state.currentFrame;
      if (!url || url === lastLoadedUrl) return;
      lastLoadedUrl = url;

      if (pendingImg) {
        pendingImg.onload = null;
        pendingImg.onerror = null;
        pendingImg = null;
      }
      const img = new Image();
      img.crossOrigin = "anonymous";
      pendingImg = img;

      const target = getInactive();
      img.onload = () => {
        if (pendingImg !== img) return;
        pendingImg = null;
        try {
          uploadImageToTexture(gl, target.tex, img);
        } catch (err) {
          console.warn("[DisplacementCanvas] texImage2D failed:", err);
          return;
        }
        target.size = [img.naturalWidth, img.naturalHeight];
        target.loaded = true;
        currIsA = !currIsA;
        drops = randomDrops();
        markImageLoaded();
      };
      img.onerror = (err) => {
        if (pendingImg !== img) return;
        pendingImg = null;
        console.warn("[DisplacementCanvas] image load failed:", err);
      };
      img.src = url;
    });

    // Kick off an immediate load if a frame is already in the store at mount.
    {
      const seed = useVisualizerStore.getState().currentFrame;
      if (seed) {
        lastLoadedUrl = seed;
        const img = new Image();
        img.crossOrigin = "anonymous";
        pendingImg = img;
        const target = getInactive();
        img.onload = () => {
          if (pendingImg !== img) return;
          pendingImg = null;
          try {
            uploadImageToTexture(gl, target.tex, img);
          } catch (err) {
            console.warn(
              "[DisplacementCanvas] initial texImage2D failed:",
              err,
            );
            return;
          }
          target.size = [img.naturalWidth, img.naturalHeight];
          target.loaded = true;
          currIsA = !currIsA;
          markImageLoaded();
        };
        img.onerror = () => {
          if (pendingImg === img) pendingImg = null;
        };
        img.src = seed;
      }
    }

    // Render state.
    let envelopes = buildEnvelopes(1);
    let lastIntensity = -1;
    const impulses = { kick: 0, snare: 0, hat: 0, vocal: 0 };
    // Seconds since each impulse-type last fired. Feeds the shader's
    // shockwave uniform so rings propagate outward from the centre over time.
    const ages = { kick: 99, snare: 99, hat: 99, vocal: 99 };
    let lastOnset = false;
    let lastTick = performance.now();
    const driftStart = performance.now();
    const mountedAt = performance.now();

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const state = useVisualizerStore.getState();
      const now = performance.now();
      const dtMs = Math.max(1, now - lastTick);
      lastTick = now;

      const intensity = state.scene.intensity;
      if (
        envelopes === null ||
        Math.abs(intensity - lastIntensity) > 0.03
      ) {
        envelopes = buildEnvelopes(intensity);
        lastIntensity = intensity;
      }
      const coef = intensityCoefficients(intensity);
      const targets = targetsFromAudio(state.audio, intensity);

      envelopes.rms.update(state.audio.rms, dtMs);
      envelopes.bass.update(state.audio.bass, dtMs);
      envelopes.mids.update(state.audio.mids, dtMs);
      envelopes.treble.update(state.audio.treble, dtMs);
      envelopes.palette.update(state.audio.centroid, dtMs);

      // Onset-type impulse routing on rising edge.
      const rising = state.audio.onset && !lastOnset;
      lastOnset = state.audio.onset;
      if (rising) {
        switch (state.audio.onsetType) {
          case "kick":
            impulses.kick = 1;
            ages.kick = 0;
            break;
          case "snare":
            impulses.snare = 1;
            ages.snare = 0;
            break;
          case "hat":
            impulses.hat = 1;
            ages.hat = 0;
            break;
          case "vocal":
            impulses.vocal = 1;
            ages.vocal = 0;
            break;
          default:
            break;
        }
      }
      const halfLife = 300 - 150 * intensity;
      const decay = Math.exp(-dtMs / Math.max(40, halfLife));
      impulses.kick *= decay;
      impulses.snare *= decay;
      impulses.hat *= decay;
      impulses.vocal *= decay;
      const dtSec = dtMs / 1000;
      ages.kick += dtSec;
      ages.snare += dtSec;
      ages.hat += dtSec;
      ages.vocal += dtSec;

      // CSS transform for drift + breath + kick jitter on the canvas itself.
      const driftT = (now - driftStart) / 1000;
      const slowPan = Math.sin(driftT * 0.05) * 12;
      const slowYaw = Math.cos(driftT * 0.07) * 1.2;
      const breath = 1 + Math.sin(driftT * 0.2) * 0.008;
      const zoomLevel = (targets.zoom ?? 1) + envelopes.bass.peak * 0.04 * intensity;
      const kickBoost = impulses.kick * coef.zoomImpulseGain;
      const jitter = kickBoost * 6;
      const jitterX = jitter * (Math.random() - 0.5);
      const jitterY = jitter * (Math.random() - 0.5);
      canvas.style.transform = `scale(${(zoomLevel * breath).toFixed(4)}) translate3d(${(
        slowPan + jitterX
      ).toFixed(2)}px, ${(-slowPan * 0.4 + jitterY).toFixed(
        2,
      )}px, 0) rotate(${slowYaw.toFixed(3)}deg)`;

      // Bleed T. If no previous or the prev slot hasn't actually loaded, fade.
      const currSlot = getCurr();
      const prevSlot = getPrev();
      const hasPrev = state.previousFrame !== null && prevSlot.loaded;
      const bleedT =
        state.crossfadeStartedAt === null
          ? currSlot.loaded
            ? 1
            : 0
          : Math.min(
              1,
              (now - state.crossfadeStartedAt) / (hasPrev ? BLEED_MS : FADE_MS),
            );

      resizeCanvasToDisplay(canvas, gl);

      // Bind active program + textures each frame (multi-component scenes would
      // otherwise leak state; cheap).
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currSlot.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevSlot.tex);

      gl.uniform1f(uni.uTime, (now - mountedAt) / 1000);
      gl.uniform1f(uni.uBass, envelopes.bass.value);
      gl.uniform1f(uni.uMids, envelopes.mids.value);
      gl.uniform1f(uni.uTreble, envelopes.treble.value);
      gl.uniform1f(uni.uRms, envelopes.rms.value);
      gl.uniform1f(uni.uRmsPeak, envelopes.rms.peak);
      gl.uniform1f(uni.uKick, impulses.kick);
      gl.uniform1f(uni.uSnare, impulses.snare);
      gl.uniform1f(uni.uHat, impulses.hat);
      gl.uniform1f(uni.uVocal, impulses.vocal);
      gl.uniform1f(uni.uIntensity, intensity);
      const huePumpNorm = coef.huePumpRange / 18;
      gl.uniform1f(uni.uHuePumpNorm, huePumpNorm);
      gl.uniform1f(uni.uPaletteShift, targets.paletteShift ?? 0);
      gl.uniform1f(uni.uHasPrev, hasPrev ? 1 : 0);
      gl.uniform1f(uni.uBleedT, bleedT);
      gl.uniform2f(uni.uCurrTexSize, currSlot.size[0], currSlot.size[1]);
      gl.uniform2f(uni.uPrevTexSize, prevSlot.size[0], prevSlot.size[1]);
      gl.uniform2f(uni.uViewSize, canvas.width, canvas.height);
      gl.uniform4f(
        uni.uImpulseAges,
        ages.kick,
        ages.snare,
        ages.hat,
        ages.vocal,
      );
      gl.uniform4f(
        uni.uDropsAB,
        drops.ab[0],
        drops.ab[1],
        drops.ab[2],
        drops.ab[3],
      );
      gl.uniform4f(
        uni.uDropsCD,
        drops.cd[0],
        drops.cd[1],
        drops.cd[2],
        drops.cd[3],
      );
      gl.uniform4f(
        uni.uDropDelays,
        drops.delays[0],
        drops.delays[1],
        drops.delays[2],
        drops.delays[3],
      );

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubFrame();
      if (pendingImg) {
        pendingImg.onload = null;
        pendingImg.onerror = null;
      }
      gl.deleteProgram(program);
      gl.deleteTexture(slotA.tex);
      gl.deleteTexture(slotB.tex);
      gl.deleteVertexArray(vao);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      style={{ willChange: "transform" }}
    />
  );
}
