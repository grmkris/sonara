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
  BASE,
  PRESETS,
  PRESET_NAMES,
  lerpPreset,
  makeDriftForPreset,
  type PresetConfig,
  type PresetDrift,
  type PresetName,
} from "@/lib/render/presets";
import { resolveAudio } from "@/lib/render/preset-audio-routing";
import { RDLayer } from "@/lib/render/rd-layer";
import {
  createFbo,
  createProgram,
  createQuadBuffer,
  createShader,
  createTexture,
  deleteFbo,
  resizeCanvasToDisplay,
  resizeFbo,
  uploadImageToTexture,
  type Fbo,
} from "@/lib/render/webgl-util";
import {
  BLIT_FRAGMENT_SHADER,
  FRAGMENT_SHADER,
  VERTEX_SHADER,
} from "./displacement-shaders";

const BLEED_MS = 7000;
const FADE_MS = 2200;
const PRESET_CROSSFADE_MS = 3500;
// Client-side session arc length. sessionProgress = min(1, (now-mountedAt)/ARC).
// Drives glitch-peek cadence, feedback trail depth, and a subtle palette temp
// via uSessionProgress in the fragment shader. Server has its own arc in
// session.ts — drift-pool bias lives there.
const SESSION_ARC_MS = 20 * 60_000;

// Module-level ref to the active WebGL canvas so sibling overlays (e.g. the
// slit-scan trail) can sample from it without prop-drilling.
let currentCanvas: HTMLCanvasElement | null = null;
export function getCurrentDisplacementCanvas(): HTMLCanvasElement | null {
  return currentCanvas;
}

interface EnvelopeBundle {
  rms: VuEnvelope;
  bass: VuEnvelope;
  mids: VuEnvelope;
  treble: VuEnvelope;
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
  };
}

interface TextureSlot {
  tex: WebGLTexture;
  size: [number, number];
  loaded: boolean;
}

interface DropLayer {
  ab: [number, number, number, number];
  cd: [number, number, number, number];
  delays: [number, number, number, number];
}
interface DropLayers {
  l1: DropLayer;
  l2: DropLayer;
  l3: DropLayer;
}

function randomDropLayers(): DropLayers {
  const rand = () => Math.random();
  const aX = 0.5 + (rand() - 0.5) * 0.25;
  const aY = 0.5 + (rand() - 0.5) * 0.25;
  return {
    l1: {
      ab: [aX, aY, rand(), rand()],
      cd: [rand(), rand(), rand(), rand()],
      delays: [0, rand() * 0.25 + 0.05, rand() * 0.35 + 0.1, rand() * 0.4 + 0.15],
    },
    l2: {
      ab: [rand(), rand(), rand(), rand()],
      cd: [rand(), rand(), rand(), rand()],
      delays: [
        rand() * 0.15,
        rand() * 0.3 + 0.1,
        rand() * 0.35 + 0.15,
        rand() * 0.4 + 0.2,
      ],
    },
    l3: {
      ab: [rand(), rand(), rand(), rand()],
      cd: [rand(), rand(), rand(), rand()],
      delays: [
        rand() * 0.2 + 0.05,
        rand() * 0.3 + 0.15,
        rand() * 0.35 + 0.2,
        rand() * 0.4 + 0.25,
      ],
    },
  };
}

interface DabPositions {
  kick: [number, number];
  snare: [number, number];
  hat: [number, number];
  vocal: [number, number];
}

function rollDab(
  kind: "kick" | "snare" | "hat" | "vocal",
  centroid: number,
): [number, number] {
  const r = Math.random;
  switch (kind) {
    case "kick":
      return [0.2 + r() * 0.6, 0.6 + r() * 0.25];
    case "snare":
      return [0.2 + r() * 0.6, 0.4 + r() * 0.2];
    case "hat":
      return [0.15 + r() * 0.7, 0.1 + r() * 0.25];
    case "vocal":
      return [0.25 + centroid * 0.5 + (r() - 0.5) * 0.15, 0.3 + r() * 0.4];
  }
}

// Apply slow LFO drift to a base preset config. Modifies a few fields so the
// preset doesn't sit still even on long tenures.
function applyDrift(
  base: PresetConfig,
  drift: PresetDrift,
  tSec: number,
): PresetConfig {
  const d = { ...base };
  if (drift.bloomMult) {
    d.bloomMult = Math.max(
      0,
      d.bloomMult + drift.bloomMult.lfo.sample(tSec) * drift.bloomMult.amplitude,
    );
  }
  if (drift.polarWarp) {
    d.polarWarp = d.polarWarp + drift.polarWarp.lfo.sample(tSec) * drift.polarWarp.amplitude;
  }
  if (drift.feedbackAmount) {
    d.feedbackAmount = Math.max(
      0,
      Math.min(
        0.85,
        d.feedbackAmount +
          drift.feedbackAmount.lfo.sample(tSec) * drift.feedbackAmount.amplitude,
      ),
    );
  }
  if (drift.noiseMult) {
    d.noiseMult = Math.max(
      0,
      d.noiseMult + drift.noiseMult.lfo.sample(tSec) * drift.noiseMult.amplitude,
    );
  }
  return d;
}

export function DisplacementCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    currentCanvas = canvas;
    const gl = canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      antialias: false,
      alpha: false,
    });
    if (!gl) return;

    // Main shader program (displacement + effects deck).
    let program: WebGLProgram;
    let blitProgram: WebGLProgram;
    try {
      const vs = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
      const fsMain = createShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
      const fsBlit = createShader(gl, gl.FRAGMENT_SHADER, BLIT_FRAGMENT_SHADER);
      program = createProgram(gl, vs, fsMain);
      blitProgram = createProgram(gl, vs, fsBlit);
      gl.deleteShader(vs);
      gl.deleteShader(fsMain);
      gl.deleteShader(fsBlit);
    } catch (err) {
      console.error("[DisplacementCanvas] shader build failed:", err);
      return;
    }

    gl.useProgram(program);

    const uni = {
      uCurr: gl.getUniformLocation(program, "uCurr"),
      uPrev: gl.getUniformLocation(program, "uPrev"),
      uFeedback: gl.getUniformLocation(program, "uFeedback"),
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
      uVocal: gl.getUniformLocation(program, "uVocal"),
      uIntensity: gl.getUniformLocation(program, "uIntensity"),
      uHuePumpNorm: gl.getUniformLocation(program, "uHuePumpNorm"),
      uPaletteShift: gl.getUniformLocation(program, "uPaletteShift"),
      uCurrTexSize: gl.getUniformLocation(program, "uCurrTexSize"),
      uPrevTexSize: gl.getUniformLocation(program, "uPrevTexSize"),
      uViewSize: gl.getUniformLocation(program, "uViewSize"),
      uImpulseAges: gl.getUniformLocation(program, "uImpulseAges"),
      uWarp: gl.getUniformLocation(program, "uWarp"),
      uMotionEnergy: gl.getUniformLocation(program, "uMotionEnergy"),
      uVignette: gl.getUniformLocation(program, "uVignette"),
      uDabPosKS: gl.getUniformLocation(program, "uDabPosKS"),
      uDabPosHV: gl.getUniformLocation(program, "uDabPosHV"),
      uDropsL1A: gl.getUniformLocation(program, "uDropsL1A"),
      uDropsL1B: gl.getUniformLocation(program, "uDropsL1B"),
      uDropDelaysL1: gl.getUniformLocation(program, "uDropDelaysL1"),
      uDropsL2A: gl.getUniformLocation(program, "uDropsL2A"),
      uDropsL2B: gl.getUniformLocation(program, "uDropsL2B"),
      uDropDelaysL2: gl.getUniformLocation(program, "uDropDelaysL2"),
      uDropsL3A: gl.getUniformLocation(program, "uDropsL3A"),
      uDropsL3B: gl.getUniformLocation(program, "uDropsL3B"),
      uDropDelaysL3: gl.getUniformLocation(program, "uDropDelaysL3"),
      // Effects-deck uniforms
      uKaleidoSegments: gl.getUniformLocation(program, "uKaleidoSegments"),
      uPolarWarp: gl.getUniformLocation(program, "uPolarWarp"),
      uPosterizeAlways: gl.getUniformLocation(program, "uPosterizeAlways"),
      uDuotoneMix: gl.getUniformLocation(program, "uDuotoneMix"),
      uDuotoneLo: gl.getUniformLocation(program, "uDuotoneLo"),
      uDuotoneHi: gl.getUniformLocation(program, "uDuotoneHi"),
      uEdge: gl.getUniformLocation(program, "uEdge"),
      uInvert: gl.getUniformLocation(program, "uInvert"),
      uFeedbackAmount: gl.getUniformLocation(program, "uFeedbackAmount"),
      uBloomMult: gl.getUniformLocation(program, "uBloomMult"),
      uNoiseMult: gl.getUniformLocation(program, "uNoiseMult"),
      uWashi: gl.getUniformLocation(program, "uWashi"),
      uDeckle: gl.getUniformLocation(program, "uDeckle"),
      uBokashi: gl.getUniformLocation(program, "uBokashi"),
      uNijimi: gl.getUniformLocation(program, "uNijimi"),
      uDrybrush: gl.getUniformLocation(program, "uDrybrush"),
      uHalation: gl.getUniformLocation(program, "uHalation"),
      uFocal: gl.getUniformLocation(program, "uFocal"),
      uGodray: gl.getUniformLocation(program, "uGodray"),
      uGrain: gl.getUniformLocation(program, "uGrain"),
      uCurl: gl.getUniformLocation(program, "uCurl"),
      uDither: gl.getUniformLocation(program, "uDither"),
      uSeal: gl.getUniformLocation(program, "uSeal"),
      uEnso: gl.getUniformLocation(program, "uEnso"),
      uSessionProgress: gl.getUniformLocation(program, "uSessionProgress"),
      uWetEdge: gl.getUniformLocation(program, "uWetEdge"),
      uGranulation: gl.getUniformLocation(program, "uGranulation"),
      uHalftone: gl.getUniformLocation(program, "uHalftone"),
      uRD: gl.getUniformLocation(program, "uRD"),
      uRDAmount: gl.getUniformLocation(program, "uRDAmount"),
      uRevealActive: gl.getUniformLocation(program, "uRevealActive"),
      uRevealT: gl.getUniformLocation(program, "uRevealT"),
      uPainterly: gl.getUniformLocation(program, "uPainterly"),
    };
    gl.uniform1i(uni.uCurr, 0);
    gl.uniform1i(uni.uPrev, 1);
    gl.uniform1i(uni.uFeedback, 2);
    gl.uniform1i(uni.uRD, 3);

    // Blit program uniform (samples the just-drawn offscreen FBO).
    const blitUSrc = gl.getUniformLocation(blitProgram, "uSrc");
    gl.useProgram(blitProgram);
    gl.uniform1i(blitUSrc, 0);
    gl.useProgram(program);

    const { vao } = createQuadBuffer(gl);

    // Reaction-diffusion overlay. Runs its own ping-pong FBO pair at fixed
    // 256×256, independent of canvas size. Presets enable it via cfg.rd > 0.
    const rdLayer = new RDLayer(gl, { vao });

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

    // Ping-pong FBOs for feedback trails. Sized to canvas each frame.
    let fboA: Fbo = createFbo(gl, canvas.clientWidth, canvas.clientHeight);
    let fboB: Fbo = createFbo(gl, canvas.clientWidth, canvas.clientHeight);
    let fboWriteIsA = true;

    let drops: DropLayers = randomDropLayers();

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
        drops = randomDropLayers();
        markImageLoaded();
      };
      img.onerror = (err) => {
        if (pendingImg !== img) return;
        pendingImg = null;
        console.warn("[DisplacementCanvas] image load failed:", err);
      };
      img.src = url;
    });

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
          drops = randomDropLayers();
          markImageLoaded();
        };
        img.onerror = () => {
          if (pendingImg === img) pendingImg = null;
        };
        img.src = seed;
      }
    }

    // ===== Preset state =====
    // Cross-fade between `from` and `to` over PRESET_CROSSFADE_MS. When the
    // store signals a change (presetTick bumps), we snapshot the current
    // effective config as `from`, set `to` to the new preset, start the fade.
    let fromCfg: PresetConfig = { ...BASE };
    let toCfg: PresetConfig = { ...BASE };
    let fadeStartAt = 0;
    let fadeInFlight = false;
    let currentPresetName: PresetName = useVisualizerStore.getState().preset;
    let currentDrift: PresetDrift = makeDriftForPreset(currentPresetName);

    const applyPreset = (newName: PresetName, atMs: number) => {
      // Snapshot whatever is currently being rendered as the fade-source.
      fromCfg = effectiveCfgSnapshot();
      // customPreset (saved snapshot) takes precedence over the named lookup
      // when present. This lets the user select a saved mid-state without
      // altering the built-in preset registry.
      const custom = useVisualizerStore.getState().customPreset;
      toCfg = custom ?? PRESETS[newName] ?? { ...BASE };
      fadeStartAt = atMs;
      fadeInFlight = true;
      currentPresetName = newName;
      currentDrift = makeDriftForPreset(newName);
    };

    // Tracks the snapshot used by applyPreset — captured from the last frame's
    // rendered uniforms.
    let lastEffective: PresetConfig = { ...BASE };
    const effectiveCfgSnapshot = (): PresetConfig => ({ ...lastEffective });

    // Watch the store for preset selection. The store increments `presetTick`
    // whenever `setPreset` is called, so changes propagate even when the name
    // happens to equal the previous one.
    const unsubPreset = useVisualizerStore.subscribe((state, prev) => {
      if (state.presetTick !== prev.presetTick) {
        applyPreset(state.preset, performance.now());
      }
    });

    // Initialise fromCfg/toCfg to the starting preset (custom takes priority
    // if a saved snapshot was already the active target post-hydration).
    const initCustom = useVisualizerStore.getState().customPreset;
    toCfg = initCustom ?? PRESETS[currentPresetName] ?? { ...BASE };
    fromCfg = { ...toCfg };

    // ===== Glitch peek scheduler =====
    // Every 30-60s, flash to a random other preset for ~1s (0.4s in, 0.2s
    // hold, 0.4s out) then return. Reads as a brief "skip" in the visuals.
    const PEEK_DURATION_MS = 1000;
    const peekIntervalMin = 30_000;
    const peekIntervalJitter = 30_000;
    let nextPeekAt =
      performance.now() + peekIntervalMin + Math.random() * peekIntervalJitter;
    let peekActive = false;
    let peekStartAt = 0;
    let peekCfg: PresetConfig | null = null;

    let envelopes = buildEnvelopes(1);
    let lastIntensity = -1;
    const impulses = { kick: 0, snare: 0, hat: 0, vocal: 0 };
    const ages = { kick: 99, snare: 99, hat: 99, vocal: 99 };
    const dabs: DabPositions = {
      kick: [0.5, 0.72],
      snare: [0.5, 0.5],
      hat: [0.5, 0.22],
      vocal: [0.5, 0.48],
    };
    let lastOnset = false;
    let lastTick = performance.now();
    const driftStart = performance.now();
    const mountedAt = performance.now();

    // Reveal-from-noise animation state. Re-armed on every image-ready event
    // (markImageLoaded writes crossfadeStartedAt); runs for REVEAL_MS, with
    // onset impulses nudging revealT forward so beats punch the materialise.
    const REVEAL_MS = 1100;
    let revealStartAt: number | null = null;
    let lastCrossfadeAt: number | null =
      useVisualizerStore.getState().crossfadeStartedAt;
    // Seed a reveal on initial mount if there's already a loaded frame — so
    // the first hero image crystallises in rather than appearing instantly.
    if (lastCrossfadeAt !== null) revealStartAt = performance.now();

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const state = useVisualizerStore.getState();
      const now = performance.now();
      const dtMs = Math.max(1, now - lastTick);
      lastTick = now;

      const intensity = state.scene.intensity;
      if (Math.abs(intensity - lastIntensity) > 0.03) {
        envelopes = buildEnvelopes(intensity, envelopes);
        lastIntensity = intensity;
      }

      // Arm a reveal whenever markImageLoaded bumps crossfadeStartedAt.
      if (state.crossfadeStartedAt !== lastCrossfadeAt) {
        lastCrossfadeAt = state.crossfadeStartedAt;
        if (state.crossfadeStartedAt !== null) revealStartAt = now;
      }
      const coef = intensityCoefficients(intensity);
      const targets = targetsFromAudio(state.audio, intensity);

      envelopes.rms.update(state.audio.rms, dtMs);
      envelopes.bass.update(state.audio.bass, dtMs);
      envelopes.mids.update(state.audio.mids, dtMs);
      envelopes.treble.update(state.audio.treble, dtMs);

      const rising = state.audio.onset && !lastOnset;
      lastOnset = state.audio.onset;
      if (rising) {
        switch (state.audio.onsetType) {
          case "kick":
            impulses.kick = 1;
            ages.kick = 0;
            dabs.kick = rollDab("kick", state.audio.centroid);
            break;
          case "snare":
            impulses.snare = 1;
            ages.snare = 0;
            dabs.snare = rollDab("snare", state.audio.centroid);
            break;
          case "hat":
            impulses.hat = 1;
            ages.hat = 0;
            dabs.hat = rollDab("hat", state.audio.centroid);
            break;
          case "vocal":
            impulses.vocal = 1;
            ages.vocal = 0;
            dabs.vocal = rollDab("vocal", state.audio.centroid);
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

      // Keep FBOs sized to the drawing buffer.
      fboA = resizeFbo(gl, fboA, canvas.width, canvas.height);
      fboB = resizeFbo(gl, fboB, canvas.width, canvas.height);

      // ===== Preset effective config for this frame =====
      let fadeT = 1;
      if (fadeInFlight) {
        fadeT = Math.min(1, (now - fadeStartAt) / PRESET_CROSSFADE_MS);
        if (fadeT >= 1) fadeInFlight = false;
      }
      // easeOutBack — linear t is jarring; overshoot makes the switch feel
      // like a flip-card settling, not a dissolve.
      const s = 1.70158;
      const u = fadeT - 1;
      const easedT = u * u * ((s + 1) * u + s) + 1;
      const blended = lerpPreset(fromCfg, toCfg, easedT);
      let effective = applyDrift(
        blended,
        currentDrift,
        (now - mountedAt) / 1000,
      );

      // Session progress drives glitch-peek cadence (shorter gaps late in the
      // session), feedback trail depth, and a subtle palette temp shift.
      const sessionProgress = Math.min(
        1,
        (now - mountedAt) / SESSION_ARC_MS,
      );
      // As progress → 1, peek interval halves: 30s→15s min, 30s→15s jitter.
      const peekIntervalMinNow = peekIntervalMin * (1 - 0.5 * sessionProgress);
      const peekIntervalJitterNow =
        peekIntervalJitter * (1 - 0.5 * sessionProgress);

      // Glitch-peek overlay: triangle envelope (0→1→1→0 over 0.4/0.2/0.4s)
      // blended on top of the drifted base. Fires at random intervals so
      // long listening sessions never feel static.
      if (!peekActive && now >= nextPeekAt) {
        const pool = PRESET_NAMES.filter((n) => n !== currentPresetName);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) {
          peekCfg = PRESETS[pick] ?? null;
          peekActive = peekCfg !== null;
          peekStartAt = now;
        } else {
          nextPeekAt = now + peekIntervalMinNow;
        }
      }
      if (peekActive && peekCfg) {
        const p = (now - peekStartAt) / PEEK_DURATION_MS;
        if (p >= 1) {
          peekActive = false;
          peekCfg = null;
          nextPeekAt =
            now + peekIntervalMinNow + Math.random() * peekIntervalJitterNow;
        } else {
          const peekT =
            p < 0.4 ? p / 0.4 : p < 0.6 ? 1 : 1 - (p - 0.6) / 0.4;
          effective = lerpPreset(effective, peekCfg, peekT);
        }
      }

      lastEffective = effective;
      useVisualizerStore.getState().setLastEffective(effective);

      // ===== Advance reaction-diffusion overlay =====
      // Only step when any preset is asking for it (cfg.rd > 0). Skipping
      // when off keeps the GPU idle on non-RD presets. Uses absolute kick
      // amplitude so rising-edge seeding is stable across the crossfade.
      const rdTex =
        effective.rd > 0.001
          ? rdLayer.update({
              feed: effective.rdFeed,
              kill: effective.rdKill,
              kickImpulse: impulses.kick,
              rms: envelopes.rms.value,
            })
          : rdLayer.getTexture();

      // ===== Render main pass to offscreen FBO =====
      const writeFbo = fboWriteIsA ? fboA : fboB;
      const readFbo = fboWriteIsA ? fboB : fboA;
      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo.fbo);
      gl.viewport(0, 0, writeFbo.width, writeFbo.height);

      gl.useProgram(program);
      gl.bindVertexArray(vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currSlot.tex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, prevSlot.tex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, readFbo.tex);
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, rdTex);

      gl.uniform1f(uni.uTime, (now - mountedAt) / 1000);
      // Per-preset audio routing: each preset can redirect which audio source
      // feeds which logical slot (e.g. frost.kick reads rms, neon_line.bass
      // reads treble). Unrouted presets get identity mapping (bass→bass, …).
      // rmsPeak is always the raw value — it's the master "peak" channel
      // and isn't semantically remappable.
      const routedAudio = resolveAudio(currentPresetName, {
        rms: envelopes.rms.value,
        rmsPeak: envelopes.rms.peak,
        bass: envelopes.bass.value,
        mids: envelopes.mids.value,
        treble: envelopes.treble.value,
        kick: impulses.kick,
        snare: impulses.snare,
        hat: impulses.hat,
        vocal: impulses.vocal,
      });
      gl.uniform1f(uni.uBass, routedAudio.bass);
      gl.uniform1f(uni.uMids, routedAudio.mids);
      gl.uniform1f(uni.uTreble, routedAudio.treble);
      gl.uniform1f(uni.uRms, routedAudio.rms);
      gl.uniform1f(uni.uRmsPeak, envelopes.rms.peak);
      gl.uniform1f(uni.uKick, routedAudio.kick);
      gl.uniform1f(uni.uSnare, routedAudio.snare);
      gl.uniform1f(uni.uVocal, routedAudio.vocal);
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
      gl.uniform1f(uni.uWarp, targets.warp ?? 0);
      gl.uniform1f(uni.uMotionEnergy, targets.motionEnergy ?? 0);
      gl.uniform1f(uni.uVignette, targets.vignette ?? 0);
      gl.uniform4f(
        uni.uDabPosKS,
        dabs.kick[0],
        dabs.kick[1],
        dabs.snare[0],
        dabs.snare[1],
      );
      gl.uniform4f(
        uni.uDabPosHV,
        dabs.hat[0],
        dabs.hat[1],
        dabs.vocal[0],
        dabs.vocal[1],
      );

      const { l1, l2, l3 } = drops;
      gl.uniform4f(uni.uDropsL1A, l1.ab[0], l1.ab[1], l1.ab[2], l1.ab[3]);
      gl.uniform4f(uni.uDropsL1B, l1.cd[0], l1.cd[1], l1.cd[2], l1.cd[3]);
      gl.uniform4f(uni.uDropDelaysL1, l1.delays[0], l1.delays[1], l1.delays[2], l1.delays[3]);
      gl.uniform4f(uni.uDropsL2A, l2.ab[0], l2.ab[1], l2.ab[2], l2.ab[3]);
      gl.uniform4f(uni.uDropsL2B, l2.cd[0], l2.cd[1], l2.cd[2], l2.cd[3]);
      gl.uniform4f(uni.uDropDelaysL2, l2.delays[0], l2.delays[1], l2.delays[2], l2.delays[3]);
      gl.uniform4f(uni.uDropsL3A, l3.ab[0], l3.ab[1], l3.ab[2], l3.ab[3]);
      gl.uniform4f(uni.uDropsL3B, l3.cd[0], l3.cd[1], l3.cd[2], l3.cd[3]);
      gl.uniform4f(uni.uDropDelaysL3, l3.delays[0], l3.delays[1], l3.delays[2], l3.delays[3]);

      // Effects-deck uniforms from the blended+drifted preset.
      gl.uniform1f(uni.uKaleidoSegments, effective.kaleidoSegments);
      gl.uniform1f(uni.uPolarWarp, effective.polarWarp);
      gl.uniform1f(uni.uPosterizeAlways, effective.posterizeAlways);
      gl.uniform1f(uni.uDuotoneMix, effective.duotoneMix);
      gl.uniform3f(uni.uDuotoneLo, effective.duotoneLo[0], effective.duotoneLo[1], effective.duotoneLo[2]);
      gl.uniform3f(uni.uDuotoneHi, effective.duotoneHi[0], effective.duotoneHi[1], effective.duotoneHi[2]);
      gl.uniform1f(uni.uEdge, effective.edge);
      gl.uniform1f(uni.uInvert, effective.invert);
      gl.uniform1f(uni.uFeedbackAmount, effective.feedbackAmount);
      gl.uniform1f(uni.uBloomMult, effective.bloomMult);
      gl.uniform1f(uni.uNoiseMult, effective.noiseMult);
      gl.uniform1f(uni.uWashi, effective.washi);
      gl.uniform1f(uni.uDeckle, effective.deckle);
      gl.uniform1f(uni.uBokashi, effective.bokashi);
      gl.uniform1f(uni.uNijimi, effective.nijimi);
      gl.uniform1f(uni.uDrybrush, effective.drybrush);
      gl.uniform1f(uni.uHalation, effective.halation);
      gl.uniform1f(uni.uFocal, effective.focal);
      gl.uniform1f(uni.uGodray, effective.godray);
      gl.uniform1f(uni.uGrain, effective.grain);
      gl.uniform1f(uni.uCurl, effective.curl);
      gl.uniform1f(uni.uDither, effective.dither);
      gl.uniform1f(uni.uSeal, effective.seal);
      gl.uniform1f(uni.uEnso, effective.enso);
      gl.uniform1f(uni.uSessionProgress, sessionProgress);
      gl.uniform1f(uni.uWetEdge, effective.wetEdge);
      gl.uniform1f(uni.uGranulation, effective.granulation);
      gl.uniform1f(uni.uHalftone, effective.halftone);
      gl.uniform1f(uni.uPainterly, effective.painterly);
      gl.uniform1f(uni.uRDAmount, effective.rd);

      // Reveal-from-noise. Base progress is linear over REVEAL_MS; kick/snare
      // onsets nudge it forward so beats actually "materialise" pixels.
      let revealActive = 0;
      let revealT = 1;
      if (revealStartAt !== null) {
        const elapsed = now - revealStartAt;
        if (elapsed < REVEAL_MS) {
          const base = Math.min(1, elapsed / REVEAL_MS);
          const bump = impulses.kick * 0.06 + impulses.snare * 0.03;
          revealT = Math.min(1, base + bump);
          revealActive = 1;
        } else {
          revealStartAt = null;
        }
      }
      gl.uniform1f(uni.uRevealActive, revealActive);
      gl.uniform1f(uni.uRevealT, revealT);

      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // ===== Blit offscreen FBO to default framebuffer =====
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(blitProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, writeFbo.tex);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      // Swap ping-pong FBOs so next frame samples this one as feedback.
      fboWriteIsA = !fboWriteIsA;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      unsubFrame();
      unsubPreset();
      if (pendingImg) {
        pendingImg.onload = null;
        pendingImg.onerror = null;
      }
      if (currentCanvas === canvas) currentCanvas = null;
      gl.deleteProgram(program);
      gl.deleteProgram(blitProgram);
      gl.deleteTexture(slotA.tex);
      gl.deleteTexture(slotB.tex);
      deleteFbo(gl, fboA);
      deleteFbo(gl, fboB);
      rdLayer.dispose();
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
