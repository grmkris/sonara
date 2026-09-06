import { DEFAULT_EXPERIENCE, EMPTY_MUSIC, defaultAudio } from "@sonara/shared";
import type {
  AudioFeatureFrame,
  EngineConfig,
  MusicalFrame,
  PerformanceControlFrame,
  TakeEvent,
} from "@sonara/shared";

import { WORLDS, lookMacros } from "./catalog";
import { InstrumentRenderer } from "./renderer";
import { smoothControls } from "./smooth-controls";
import { SurfaceControls } from "./surface-controls";
import { Transport } from "./transport";

export class InstrumentRuntime {
  readonly transport = new Transport();
  readonly renderer: InstrumentRenderer;
  config: EngineConfig;
  audio: AudioFeatureFrame = {
    confidence: 0,
    features: { ...defaultAudio },
    time: 0,
  };
  controls: PerformanceControlFrame = {
    attractors: [],
    expansion: 0.5,
    rotation: 0,
    time: 0,
  };
  onEvent: ((event: TakeEvent) => void) | null = null;
  onConfig: ((config: EngineConfig) => void) | null = null;
  music: MusicalFrame = { ...EMPTY_MUSIC };
  elapsed = 0;
  replaying = false;
  private surfaceControls = new SurfaceControls();
  private targetControls = this.controls;
  private lastControlAt = -100;
  private lastAudioAt = -100;
  private lastAudioInput: AudioFeatureFrame | null = null;
  private audioUpdated = false;
  private controlsUpdated = false;
  private lastSmoothingAt = 0;
  private lastBeat = 0;
  private lastScene = 0;
  private sceneIndex = 0;
  private transition: {
    from: number;
    to: number;
    start: number;
    duration: number;
  } | null = null;
  private manualUntil = 0;
  constructor(
    canvas: HTMLCanvasElement,
    config: EngineConfig = DEFAULT_EXPERIENCE,
    forceWebGL = false
  ) {
    this.config = structuredClone(config);
    this.renderer = new InstrumentRenderer(canvas, this.config, forceWebGL);
  }
  async init(): Promise<void> {
    await this.renderer.init();
  }
  configure(config: EngineConfig, manual = true): void {
    if (this.config.version !== config.version) {
      this.surfaceControls.reset();
    }
    this.config = structuredClone(config);
    this.renderer.configure(this.config);
    if (manual) {
      this.manualUntil = this.elapsed + 8;
      this.transition = null;
    }
    this.onEvent?.({
      config: structuredClone(config),
      kind: "scene",
      time: this.elapsed,
    });
  }
  setAudio(frame: AudioFeatureFrame): void {
    if (frame === this.lastAudioInput) {
      return;
    }
    this.lastAudioInput = frame;
    this.audio = frame;
    this.music = frame.music ?? { ...EMPTY_MUSIC, time: frame.time };
    this.audioUpdated = true;
  }
  setControls(control: PerformanceControlFrame): void {
    this.targetControls = control;
    this.controlsUpdated = true;
  }
  freeze(): void {
    this.transport.frozen = !this.transport.frozen;
    this.onEvent?.({
      frozen: this.transport.frozen,
      kind: "freeze",
      time: this.elapsed,
    });
  }
  reset(): void {
    this.surfaceControls.reset();
    if (this.config.version >= 4) {
      this.controls = {
        attractors: [],
        contacts: [],
        expansion: 0.5,
        rotation: 0,
        time: this.elapsed,
      };
    }
    this.renderer.reset();
    this.transport.reset();
    this.onEvent?.({ kind: "reset", time: this.elapsed });
  }
  advance(time: number): void {
    this.elapsed = time;
    // Inputs arrive between draws. Timestamp them on this draw, not the
    // previous one, so slow graphics cannot immediately expire fresh input.
    if (this.audioUpdated) {
      this.lastAudioAt = time;
      this.audioUpdated = false;
    }
    if (this.controlsUpdated) {
      this.lastControlAt = time;
      this.controlsUpdated = false;
    }
    if (time - this.lastAudioAt > 0.3) {
      this.audio = { confidence: 0, features: { ...defaultAudio }, time };
      this.music = { ...EMPTY_MUSIC, time };
    }
    if (this.config.version === 3 && !this.replaying) {
      const dt = Math.max(0, Math.min(0.1, time - this.lastSmoothingAt));
      this.lastSmoothingAt = time;
      this.controls = smoothControls(
        this.controls,
        this.targetControls,
        dt,
        time - this.lastControlAt,
        time
      );
    }
    this.transport.advance(
      time,
      this.audio.features.bpm,
      () => {
        this.step();
      },
      this.config.version === 1 ? 6 : 3
    );
    this.renderer.present(time);
  }
  private step(): void {
    const target =
      this.elapsed - this.lastControlAt < 0.25
        ? this.targetControls
        : { ...this.targetControls, attractors: [] };
    if (!this.replaying && this.config.version >= 4) {
      this.controls = this.surfaceControls.step(
        this.controls,
        this.targetControls,
        this.elapsed - this.lastControlAt,
        this.elapsed
      );
    }
    if (!this.replaying && this.config.version < 3) {
      this.controls = {
        // oxlint-disable-next-line complexity -- REVIEW: interpolate two optional tracked controls and decay missing inputs
        attractors: [0, 1].flatMap((i) => {
          const to = target.attractors[i];
          const from = this.controls.attractors[i];
          const force =
            (from?.force ?? 0) + ((to?.force ?? 0) - (from?.force ?? 0)) * 0.2;
          return Math.abs(force) < 0.005
            ? []
            : [
                {
                  force,
                  x:
                    (from?.x ?? to?.x ?? 0.5) +
                    ((to?.x ?? from?.x ?? 0.5) - (from?.x ?? to?.x ?? 0.5)) *
                      0.3,
                  y:
                    (from?.y ?? to?.y ?? 0.5) +
                    ((to?.y ?? from?.y ?? 0.5) - (from?.y ?? to?.y ?? 0.5)) *
                      0.3,
                },
              ];
        }),
        expansion:
          this.controls.expansion +
          (target.expansion - this.controls.expansion) * 0.12,
        rotation:
          this.controls.rotation +
          (target.rotation - this.controls.rotation) * 0.12,
        time: this.elapsed,
      };
    }
    if (this.config.version !== 1) {
      this.onEvent?.({
        control: this.controls,
        frame: this.music,
        kind: "motion",
        simulationTime: this.transport.time,
        time: this.elapsed,
      });
      this.renderer.step(
        this.transport.time,
        this.audio,
        this.controls,
        this.music
      );
      return;
    }
    this.onEvent?.({ frame: this.audio, kind: "audio", time: this.elapsed });
    this.onEvent?.({
      frame: this.controls,
      kind: "control",
      time: this.elapsed,
    });
    this.conduct();
    this.renderer.step(this.transport.time, this.audio, this.controls);
  }
  private conduct(): void {
    if (
      this.config.version !== 1 ||
      !this.config.conductor ||
      this.elapsed < this.manualUntil
    ) {
      return;
    }
    const beat = Math.floor(this.transport.beat);
    const boundary = beat !== this.lastBeat && beat % 16 === 0;
    this.lastBeat = beat;
    if (
      !this.transition &&
      this.elapsed - this.lastScene > 16 &&
      boundary &&
      this.audio.confidence > 0.5 &&
      this.audio.features.rms > 0.01
    ) {
      const deck = this.config.crossfade < 0.5 ? "b" : "a";
      this.sceneIndex = (this.sceneIndex + 1) % WORLDS.length;
      const world = WORLDS[this.sceneIndex]?.id ?? "liquid";
      // Camera and paid generation are never automatically armed.
      const nextWorld = world === "mirror" ? "cosmos" : world;
      const look = Math.min(
        2,
        Math.floor(this.audio.features.sectionEnergy * 10)
      );
      this.config = {
        ...this.config,
        [deck]: { look, macros: lookMacros(look), world: nextWorld },
      };
      this.configure(this.config, false);
      this.transition = {
        duration: (4 * 60) / Math.max(40, this.transport.bpm),
        from: this.config.crossfade,
        start: this.elapsed,
        to: deck === "b" ? 1 : 0,
      };
      this.lastScene = this.elapsed;
      this.onConfig?.(this.config);
    }
    if (this.transition) {
      const progress = Math.min(
        1,
        (this.elapsed - this.transition.start) / this.transition.duration
      );
      const eased = progress * progress * (3 - 2 * progress);
      const config = {
        ...this.config,
        crossfade:
          this.transition.from +
          (this.transition.to - this.transition.from) * eased,
      };
      this.config = config;
      this.renderer.configure(config);
      this.onEvent?.({ config, kind: "scene", time: this.elapsed });
      if (progress === 1) {
        this.transition = null;
        this.onConfig?.(config);
      }
    }
  }
  async applyEvent(event: TakeEvent): Promise<void> {
    switch (event.kind) {
      case "motion": {
        this.music = event.frame;
        this.controls = event.control;
        this.renderer.step(
          event.simulationTime,
          this.audio,
          this.controls,
          this.music
        );
        break;
      }
      case "scene": {
        this.config = event.config;
        this.renderer.configure(event.config);
        break;
      }
      case "audio": {
        this.setAudio(event.frame);
        break;
      }
      case "control": {
        this.controls = event.frame;
        this.setControls(event.frame);
        break;
      }
      case "image": {
        await this.renderer.setImage(event.url);
        break;
      }
      case "depth": {
        await this.renderer.setDepth(event.url);
        break;
      }
      case "image-clear": {
        this.renderer.clearImage();
        break;
      }
      case "freeze": {
        this.transport.frozen = event.frozen;
        break;
      }
      case "reset": {
        this.renderer.reset();
        this.transport.reset();
        break;
      }
      default: {
        break;
      }
    }
  }
  dispose(): void {
    this.renderer.dispose();
  }
}
