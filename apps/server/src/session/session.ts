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
import { sampleDrift } from "../generation/prompt-drift";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  send: (event: ServerEvent) => void;
  logger: Logger;
}

type TriggerReason = "pause" | "semantic" | "periodic" | "section" | "commit";

// Baseline thresholds. PERIODIC_MS and PAUSE_MS are intensity-derived
// (see cadenceFromIntensity below).
const SEMANTIC_THRESHOLD = 0.3;
const SECTION_DELTA_THRESHOLD = 0.5;
const SECTION_SUSTAIN_MS = 500;

// 2^31 - 1 is the widest safe range for fal's int seed.
const SEED_MAX = 2_147_483_647;
function rollSeed(): number {
  return Math.floor(Math.random() * SEED_MAX);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// Intensity 0..1 → periodic + pause timing. Matches plan doc D1.
function cadenceFromIntensity(i: number): { periodicMs: number; pauseMs: number } {
  const I = Math.max(0, Math.min(1, i));
  return {
    // Tighter cadence so the image is always in mid-evolution. Flow-tier
    // frames don't promote to hero (see trigger() below), so identity stays
    // pinned even at 2s regen intervals.
    periodicMs: Math.round(lerp(8_000, 2_000, I)),
    pauseMs: Math.round(lerp(1_500, 400, I)),
  };
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

  private seed: number = rollSeed();

  // Single-hero identity anchor. Updated ONLY on commit-tier completion.
  // Flow-tier frames condition on this but never mutate it — prevents the
  // frame-to-frame drift compounding that a rolling ring buffer causes.
  private heroImageUrl: string | null = null;

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
    this.schedulePause();
  }

  applyAudio(features: AudioFeatures): void {
    this.lastAudioAt = Date.now();

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
    this.heroImageUrl = null;
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
    const { pauseMs } = cadenceFromIntensity(this.scene.intensity);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      const diff = semanticDiff(this.lastGeneratedScene, this.scene);
      if (diff > 0.05) this.trigger("pause");
    }, pauseMs);
  }

  private startPeriodic(): void {
    this.periodicTimer = setInterval(() => {
      const now = Date.now();
      const { periodicMs } = cadenceFromIntensity(this.scene.intensity);
      if (now - this.lastKeyframeAt < periodicMs) return;
      const hasAudio = now - this.lastAudioAt < 5000;
      const hasScene = this.scene.subject.trim().length > 0;
      if (!hasAudio && !hasScene) return;
      this.trigger("periodic");
    }, 1000);
  }

  private trigger(reason: TriggerReason): void {
    const basePrompt = buildPrompt(this.scene);
    if (!basePrompt.trim()) {
      this.logger.debug({ reason }, "trigger skipped: empty prompt");
      return;
    }
    // Atmospheric modifier sampled fresh each trigger — same dream, different
    // weather. Subject/identity clauses are untouched (composed on top of
    // buildPrompt's output, never inside it).
    const drift = sampleDrift();
    const prompt = drift ? `${basePrompt}, ${drift}` : basePrompt;

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;

    this.activeVersion += 1;
    const version = this.activeVersion;
    // Surface hero URL in scene.references for wire compatibility; the real
    // source of truth is this.heroImageUrl on the server.
    const nextReferences = this.heroImageUrl ? [this.heroImageUrl] : [];
    this.scene = { ...this.scene, version, references: nextReferences };
    const snapshot: DreamSceneState = this.scene;
    const forCommit = reason === "commit";

    this.send({ type: "scene.state", state: this.scene });
    this.logger.info(
      {
        reason,
        version,
        prompt,
        drift,
        seed: this.seed,
        hasHero: this.heroImageUrl !== null,
        tier: forCommit ? "commit" : "flow",
      },
      "trigger fire",
    );
    this.send({ type: "job.status", status: "running", reason });
    this.lastKeyframeAt = Date.now();

    streamPreview({
      prompt,
      referenceImages: nextReferences,
      seed: this.seed,
      forCommit,
      signal: controller.signal,
      logger: this.logger,
      onPreview: (url) => {
        if (version !== this.activeVersion) return;
        this.send({ type: "frame.preview", imageUrl: url, version });
      },
      onFinal: (url) => {
        if (version !== this.activeVersion) return;
        this.lastGeneratedScene = snapshot;
        // Only commit-tier frames promote to hero. Flow-tier frames are
        // transient and never become anchors; this is what stops identity
        // drift from compounding.
        if (forCommit) {
          this.heroImageUrl = url;
          this.scene = { ...this.scene, references: [url] };
          this.send({ type: "scene.state", state: this.scene });
          this.logger.info({ url }, "hero image updated (commit-tier)");
        }
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
