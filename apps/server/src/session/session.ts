import {
  type AudioFeatures,
  type ClientScenePatch,
  type DreamSceneState,
  type ServerEvent,
  defaultScene,
  getSceneTemplate,
} from "@music-visualizer/shared";
import type { Logger } from "../lib/logger";
import { streamPreview } from "../generation/fal-provider";
import { buildPrompt } from "../generation/prompt-compiler";
import { sampleDriftLayered } from "../generation/prompt-drift";
import { parseVoiceIntent, type VoiceIntent } from "../generation/voice-intent";
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

const VOICE_PHRASE_TTL_MS = 30_000;
const VOICE_BUFFER_MAX = 8;

// How long a voice-derived atmosphere clause stays "fresh" before we let
// drift fall through to the rotating static pool. Without this, one voice
// phrase sticks forever and every subsequent trigger reuses the identical
// drift clause — images stop subtly morphing between generations.
const ATMOSPHERE_TTL_MS = 15_000;

// Full-arc length. sessionProgress = min(1, (now - sessionStartAt) / SESSION_ARC_MS).
// Drives: drift-pool act bias (intro/build/dissolve weights in prompt-drift).
// Also exposed on the client over scene.state so the renderer can modulate
// trail decay, glitch-peek cadence, and a subtle palette-temp over the arc.
const SESSION_ARC_MS = 20 * 60_000;

// Reset-via-voice shows the user a 10s confirm toast before actually firing.
const RESET_CONFIRM_TTL_MS = 10_000;

// Baseline thresholds. PERIODIC_MS and PAUSE_MS are intensity-derived
// (see cadenceFromIntensity below).
const SEMANTIC_THRESHOLD = 0.3;
// When a patch arrives via voice, drop the trigger threshold so mood /
// palette-only changes still fire immediately.
const SEMANTIC_THRESHOLD_VOICE = 0.1;
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

// Intensity 0..1 → periodic + pause timing.
function cadenceFromIntensity(i: number): { periodicMs: number; pauseMs: number } {
  const I = Math.max(0, Math.min(1, i));
  return {
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
  private heroImageUrl: string | null = null;

  private lastSectionEnergy = 0;
  private sectionDeltaStartedAt: number | null = null;
  private lastAudioAt = 0;
  private lastValence = 0.5;
  private lastArousal = 0;

  private voiceBuffer: { text: string; at: number }[] = [];
  private currentAtmosphere: string | null = null;
  private currentAtmosphereAt = 0;
  private sessionStartAt = Date.now();
  private voiceInFlight?: AbortController;
  private voiceDebounceTimer?: ReturnType<typeof setTimeout>;

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

  applyPatch(
    patch: ClientScenePatch,
    origin: "client" | "voice" = "client",
  ): void {
    const next: DreamSceneState = { ...this.scene, ...patch };
    this.scene = next;
    this.send({ type: "scene.state", state: next });

    const threshold =
      origin === "voice" ? SEMANTIC_THRESHOLD_VOICE : SEMANTIC_THRESHOLD;
    const diff = semanticDiff(this.lastGeneratedScene, next);
    if (diff > threshold) {
      this.trigger(origin === "voice" ? "voice" : "semantic");
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

  // Incoming voice transcript. Pushed onto the rolling buffer; after a 1.5s
  // debounce we send the latest phrase through the LLM intent parser, then
  // dispatch whatever structural / command intent it returned.
  applyVoice(text: string): void {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const now = Date.now();
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

    // Debounce: wait for the user to finish the thought before spending
    // an LLM call. Each new phrase resets the timer.
    if (this.voiceDebounceTimer) clearTimeout(this.voiceDebounceTimer);
    this.voiceDebounceTimer = setTimeout(() => {
      this.voiceDebounceTimer = undefined;
      this.dispatchVoice(trimmed).catch((err) => {
        this.logger.warn({ err }, "dispatchVoice unhandled");
      });
    }, 1500);
  }

  private async dispatchVoice(phrase: string): Promise<void> {
    this.voiceInFlight?.abort();
    const controller = new AbortController();
    this.voiceInFlight = controller;

    const history = this.voiceBuffer
      .slice()
      .reverse()
      .map((e) => e.text)
      .filter((t) => t !== phrase);

    let intent: VoiceIntent;
    try {
      intent = await parseVoiceIntent(
        {
          phrase,
          scene: {
            subject: this.scene.subject,
            environment: this.scene.environment,
            mood: this.scene.mood,
            palette: this.scene.palette,
            intensity: this.scene.intensity,
          },
          voiceHistory: history,
          valence: this.lastValence,
          arousal: this.lastArousal,
          previousAtmosphere: this.currentAtmosphere,
        },
        { signal: controller.signal, logger: this.logger },
      );
    } catch (err) {
      if (!controller.signal.aborted) {
        this.logger.warn({ err }, "parseVoiceIntent threw");
      }
      return;
    } finally {
      if (this.voiceInFlight === controller) this.voiceInFlight = undefined;
    }
    if (controller.signal.aborted) return;

    this.logger.info(
      {
        phrase,
        patch: intent.patch,
        commit: intent.commit,
        reset: intent.reset,
        preset: intent.preset,
        atmosphere: intent.atmosphere,
      },
      "voice intent parsed",
    );

    // Always update atmosphere (flavors subsequent triggers).
    if (intent.atmosphere) {
      this.currentAtmosphere = intent.atmosphere;
      this.currentAtmosphereAt = Date.now();
    }

    // Visual-preset suggestion is advisory. The client gates on its own
    // presetMode === "llm" before actually applying it.
    if (intent.lookPreset) {
      this.send({ type: "preset.suggest", name: intent.lookPreset });
    }

    // Reset wins but only after user confirms on the client.
    if (intent.reset) {
      this.send({
        type: "confirm.reset",
        ttlMs: RESET_CONFIRM_TTL_MS,
        reason: `voice: "${phrase}"`,
      });
      return;
    }

    // Scene template fills blanks; explicit patch overrides template fields.
    let patch: ClientScenePatch = { ...intent.patch };
    if (intent.preset) {
      const template = getSceneTemplate(intent.preset);
      if (template) {
        patch = { ...template.scene, ...patch };
      } else {
        this.logger.warn(
          { key: intent.preset },
          "unknown scene template from voice",
        );
      }
    }

    if (Object.keys(patch).length > 0) {
      this.applyPatch(patch, "voice");
    }

    if (intent.commit) {
      this.commit();
    }
  }

  reset(): void {
    this.activeJob?.abort();
    this.voiceInFlight?.abort();
    if (this.voiceDebounceTimer) {
      clearTimeout(this.voiceDebounceTimer);
      this.voiceDebounceTimer = undefined;
    }
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.activeVersion = 0;
    this.lastKeyframeAt = 0;
    this.seed = rollSeed();
    this.heroImageUrl = null;
    this.voiceBuffer = [];
    this.currentAtmosphere = null;
    this.currentAtmosphereAt = 0;
    this.sessionStartAt = Date.now();
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "job.status", status: "idle" });
  }

  close(): void {
    this.activeJob?.abort();
    this.voiceInFlight?.abort();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.periodicTimer) clearInterval(this.periodicTimer);
    if (this.voiceDebounceTimer) clearTimeout(this.voiceDebounceTimer);
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
    // Drift layering: current atmosphere (from voice-intent) →
    // most-recent voice phrase raw → static pool.
    const latestVoice = this.getLatestVoice();
    const atmosphereFresh =
      this.currentAtmosphere !== null &&
      Date.now() - this.currentAtmosphereAt < ATMOSPHERE_TTL_MS;
    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS,
    );
    const drift = sampleDriftLayered({
      llmDrift: atmosphereFresh ? this.currentAtmosphere : null,
      latestVoice,
      sessionProgress,
    });
    const prompt = drift ? `${basePrompt}, ${drift}` : basePrompt;

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;

    this.activeVersion += 1;
    const version = this.activeVersion;
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
        driftSource: atmosphereFresh
          ? "llm"
          : latestVoice
            ? "voice"
            : "pool",
        sessionProgress: Number(sessionProgress.toFixed(2)),
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
