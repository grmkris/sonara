import {
  type AudioFeatures,
  type ClientScenePatch,
  type DreamSceneState,
  type ServerEvent,
  defaultScene,
} from "@music-visualizer/shared";
import type { Logger } from "../lib/logger";
import { streamPreview } from "../generation/fal-provider";
import { buildPrompt } from "../generation/prompt-compiler";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  send: (event: ServerEvent) => void;
  logger: Logger;
}

type TriggerReason = "pause" | "semantic" | "periodic" | "section" | "commit";

const PAUSE_MS = 600;
const PERIODIC_MS = 4000;
const SEMANTIC_THRESHOLD = 0.3;
const SECTION_DELTA_THRESHOLD = 0.5;
const SECTION_SUSTAIN_MS = 500;

// 2^31 - 1 is the widest safe range for fal's int seed.
const SEED_MAX = 2_147_483_647;
function rollSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}

export class Session {
  readonly id: string;
  private scene: DreamSceneState;
  private lastGeneratedScene: DreamSceneState;
  private activeJob?: AbortController;
  private activeVersion = 0;
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private lastKeyframeAt = 0;
  private readonly send: (e: ServerEvent) => void;
  private readonly logger: Logger;

  // Per-session seed pinned at construction and rerolled on reset(). With the
  // FLUX.2 klein edit endpoint, the same seed across calls keeps the subject's
  // identity stable across frames (no "new cat every generation").
  private seed: number = rollSeed();

  // Section detection state.
  private lastSectionEnergy = 0;
  private sectionDeltaStartedAt: number | null = null;
  private lastAudioAt = 0;

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.send = opts.send;
    this.logger = opts.logger.child({ sessionId: opts.id });
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.startPeriodic();
  }

  init(): void {
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "job.status", status: "idle" });
  }

  applyPatch(patch: ClientScenePatch): void {
    const next: DreamSceneState = { ...this.scene, ...patch };
    this.scene = next;
    this.send({ type: "scene.state", state: next });

    const diff = semanticDiff(this.lastGeneratedScene, next);
    if (diff > SEMANTIC_THRESHOLD) {
      this.trigger("semantic");
      return;
    }
    // Restart pause timer — user is still editing.
    this.schedulePause();
  }

  applyAudio(features: AudioFeatures): void {
    this.lastAudioAt = Date.now();

    // Section-change detection on server-received 5 Hz feature stream.
    const delta = Math.abs(features.sectionEnergy - this.lastSectionEnergy);
    if (delta > SECTION_DELTA_THRESHOLD) {
      const now = Date.now();
      if (this.sectionDeltaStartedAt === null) {
        this.sectionDeltaStartedAt = now;
      } else if (now - this.sectionDeltaStartedAt >= SECTION_SUSTAIN_MS) {
        this.sectionDeltaStartedAt = null;
        this.lastSectionEnergy = features.sectionEnergy;
        this.trigger("section");
        return;
      }
    } else {
      this.sectionDeltaStartedAt = null;
      // Slow tracking so small drift doesn't starve the detector.
      this.lastSectionEnergy =
        this.lastSectionEnergy * 0.9 + features.sectionEnergy * 0.1;
    }
  }

  commit(): void {
    this.trigger("commit");
  }

  reset(): void {
    this.activeJob?.abort();
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.activeVersion = 0;
    this.lastKeyframeAt = 0;
    this.seed = rollSeed();
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "job.status", status: "idle" });
  }

  close(): void {
    this.activeJob?.abort();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
  }

  private schedulePause(): void {
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      const diff = semanticDiff(this.lastGeneratedScene, this.scene);
      if (diff > 0.05) this.trigger("pause");
    }, PAUSE_MS);
  }

  private startPeriodic(): void {
    this.periodicTimer = setInterval(() => {
      const now = Date.now();
      if (now - this.lastKeyframeAt < PERIODIC_MS) return;
      // Only refresh periodically if the user has spoken at all (non-empty subject)
      // or fed audio recently. Avoid burning fal calls on an idle blank session.
      const hasAudio = now - this.lastAudioAt < 5000;
      const hasScene = this.scene.subject.trim().length > 0;
      if (!hasAudio && !hasScene) return;
      this.trigger("periodic");
    }, 1000);
  }

  private trigger(reason: TriggerReason): void {
    const prompt = buildPrompt(this.scene);
    if (!prompt.trim()) {
      this.logger.debug({ reason }, "trigger skipped: empty prompt");
      return;
    }

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;

    this.activeVersion += 1;
    const version = this.activeVersion;
    this.scene = { ...this.scene, version };
    const snapshot: DreamSceneState = this.scene;
    const referenceImages = snapshot.references.slice(-4);

    this.send({ type: "scene.state", state: this.scene });
    this.logger.info(
      { reason, version, prompt, seed: this.seed, refs: referenceImages.length },
      "trigger fire",
    );
    this.send({ type: "job.status", status: "running", reason });
    this.lastKeyframeAt = Date.now();

    streamPreview({
      prompt,
      referenceImages,
      seed: this.seed,
      signal: controller.signal,
      logger: this.logger,
      onPreview: (url) => {
        if (version !== this.activeVersion) return;
        this.send({ type: "frame.preview", imageUrl: url, version });
      },
      onFinal: (url) => {
        if (version !== this.activeVersion) return;
        this.lastGeneratedScene = snapshot;
        // Keep up to the last 4 frames as references for continuity.
        const nextRefs = [...this.scene.references, url].slice(-4);
        this.scene = { ...this.scene, references: nextRefs };
        this.send({ type: "frame.final", imageUrl: url, version });
        this.send({ type: "job.status", status: "idle" });
      },
      onError: (err) => {
        if (controller.signal.aborted) return;
        this.logger.error({ err }, "fal stream error");
        this.send({
          type: "job.status",
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      },
    }).catch((err) => {
      if (!controller.signal.aborted) {
        this.logger.error({ err }, "streamPreview unhandled");
      }
    });
  }
}
