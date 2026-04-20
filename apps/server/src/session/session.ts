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
import { sampleDriftLayered } from "../generation/prompt-drift";
import { synthesizeDrift } from "../generation/llm-drift";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  send: (event: ServerEvent) => void;
  logger: Logger;
}

type TriggerReason =
  | "pause"
  | "semantic"
  | "periodic"
  | "section"
  | "commit"
  | "voice";

// Voice phrases expire after this many ms (not consumed by Phase 1 yet —
// Phase 3 will pull from this buffer when the LLM synthesizes drift).
const VOICE_PHRASE_TTL_MS = 30_000;
const VOICE_BUFFER_MAX = 8;

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
    // Cadence is shorter than the 4.5s bleed so new frames arrive while the
    // last bleed is still in progress — the image never finishes settling
    // before the next change starts, giving a continuous "always becoming"
    // feel. Slot rotation + pushFrame not resetting crossfadeStartedAt
    // handles the overlap gracefully.
    periodicMs: Math.round(lerp(7_000, 3_000, I)),
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
  // Latest smoothed mood components received from client audio features.
  // Consumed by the LLM drift synthesizer so it can bias atmosphere to the music.
  private lastValence = 0.5;
  private lastArousal = 0;

  // Rolling buffer of recent voice transcripts, newest-last.
  private voiceBuffer: { text: string; at: number }[] = [];

  // LLM-synthesized atmospheric drift. Refreshed in the background; when
  // fresh, it takes priority over raw voice phrases and the static pool.
  private currentLlmDrift: string | null = null;
  private llmRefreshTimer?: ReturnType<typeof setTimeout>;
  private llmInFlight?: AbortController;
  private lastLlmRefreshAt = 0;

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
    this.lastValence = features.valence;
    this.lastArousal = features.arousal;

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

  // Returns the most recent unexpired voice phrase, or null.
  private getLatestVoice(): string | null {
    const now = Date.now();
    for (let i = this.voiceBuffer.length - 1; i >= 0; i--) {
      const entry = this.voiceBuffer[i];
      if (!entry) continue;
      if (now - entry.at < VOICE_PHRASE_TTL_MS) return entry.text;
    }
    return null;
  }

  // Min interval between LLM calls so rapid-fire voice doesn't spam Haiku.
  // delayMs=0 means "fire on next tick subject to the floor below".
  private static readonly LLM_MIN_INTERVAL_MS = 10_000;

  private scheduleLlmRefresh(delayMs: number): void {
    if (this.llmRefreshTimer) clearTimeout(this.llmRefreshTimer);
    const sinceLast = Date.now() - this.lastLlmRefreshAt;
    const floor = Math.max(0, Session.LLM_MIN_INTERVAL_MS - sinceLast);
    const delay = Math.max(delayMs, floor);
    this.llmRefreshTimer = setTimeout(() => {
      this.llmRefreshTimer = undefined;
      this.refreshLlmDrift().catch((err) => {
        this.logger.warn({ err }, "refreshLlmDrift unhandled");
      });
    }, delay);
  }

  private async refreshLlmDrift(): Promise<void> {
    // Nothing meaningful to synthesize yet — let the pool handle it.
    const hasScene = this.scene.subject.trim().length > 0;
    if (!hasScene && this.voiceBuffer.length === 0) return;

    this.llmInFlight?.abort();
    const controller = new AbortController();
    this.llmInFlight = controller;
    this.lastLlmRefreshAt = Date.now();

    const voicePhrases = this.voiceBuffer
      .slice()
      .reverse()
      .map((e) => e.text);

    try {
      const drift = await synthesizeDrift(
        {
          scene: {
            subject: this.scene.subject,
            environment: this.scene.environment,
            mood: this.scene.mood,
            palette: this.scene.palette,
          },
          voicePhrases,
          valence: this.lastValence,
          arousal: this.lastArousal,
          previousDrift: this.currentLlmDrift,
        },
        { signal: controller.signal, logger: this.logger },
      );
      if (controller.signal.aborted) return;
      if (drift) {
        this.currentLlmDrift = drift;
        this.logger.info({ drift }, "llm drift refreshed");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        this.logger.warn({ err }, "refreshLlmDrift error");
      }
    } finally {
      if (this.llmInFlight === controller) this.llmInFlight = undefined;
    }
  }

  applyVoice(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const now = Date.now();
    // Drop expired entries before pushing.
    this.voiceBuffer = this.voiceBuffer.filter(
      (e) => now - e.at < VOICE_PHRASE_TTL_MS,
    );
    this.voiceBuffer.push({ text: trimmed, at: now });
    while (this.voiceBuffer.length > VOICE_BUFFER_MAX) {
      this.voiceBuffer.shift();
    }
    this.logger.info(
      { text: trimmed, bufferLen: this.voiceBuffer.length },
      "voice phrase",
    );
    // Debounce LLM refresh — wait for the user to finish a thought before
    // spending a Haiku call. Resets on every new phrase.
    this.scheduleLlmRefresh(1500);
  }

  reset(): void {
    this.activeJob?.abort();
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.activeVersion = 0;
    this.lastKeyframeAt = 0;
    this.seed = rollSeed();
    this.heroImageUrl = null;
    this.voiceBuffer = [];
    this.currentLlmDrift = null;
    this.lastLlmRefreshAt = 0;
    this.llmInFlight?.abort();
    if (this.llmRefreshTimer) {
      clearTimeout(this.llmRefreshTimer);
      this.llmRefreshTimer = undefined;
    }
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "job.status", status: "idle" });
  }

  close(): void {
    this.activeJob?.abort();
    this.llmInFlight?.abort();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.llmRefreshTimer) clearTimeout(this.llmRefreshTimer);
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
    // Drift is layered: fresh LLM synthesis > most-recent voice phrase > static pool.
    // Voice phrases are visible in generations the moment the user speaks;
    // the LLM takes over once it has synthesized from {scene, voice, mood}.
    const latestVoice = this.getLatestVoice();
    const drift = sampleDriftLayered({
      llmDrift: this.currentLlmDrift,
      latestVoice,
    });
    const prompt = drift ? `${basePrompt}, ${drift}` : basePrompt;
    // Keep the LLM warm in the background so next trigger has fresh synthesis.
    this.scheduleLlmRefresh(0);

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
        driftSource: this.currentLlmDrift
          ? "llm"
          : latestVoice
            ? "voice"
            : "pool",
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
