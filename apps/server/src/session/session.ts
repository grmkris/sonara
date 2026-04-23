import {
  type AudioFeatures,
  type ClientScenePatch,
  type DreamSceneState,
  type NowPlaying,
  type ServerEvent,
  defaultScene,
  getSceneTemplate,
} from "@music-visualizer/shared";
import { EventPublisher } from "@orpc/server";
import type { Logger } from "../lib/logger";
import { streamPreview, streamMorphChain } from "../generation/fal-provider";
import { buildPrompt } from "../generation/prompt-compiler";
import { sampleDriftLayered } from "../generation/prompt-drift";
import { parseVoiceIntent, type VoiceIntent } from "../generation/voice-intent";
import {
  debitFrame,
  tryConsumeFreeTier,
  type FrameKind,
} from "../credits/credits-service";
import { recognizeClip } from "../recognition/recognition-service";
import { mergeNowPlayingIntoScene } from "./now-playing-merge";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  userId: string; // raw UUID from the authenticated WS ticket
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

// Semantic diff above this, OR any voice-origin trigger, upgrades the flow
// from a single frame to a morph chain so the viewer sees the transformation
// as a sequence of img2img steps instead of one replacement frame.
const MORPH_CHAIN_DIFF_THRESHOLD = 0.6;
const MORPH_CHAIN_STEPS = 3;

// After the first "out of credits" error on an auto-trigger (periodic /
// section), suppress further errors for this long before re-emitting.
// User-initiated triggers (commit / voice / semantic / pause) always emit.
const CREDIT_DENIAL_COOLDOWN_MS = 60_000;
// When a patch arrives via voice, drop the trigger threshold so mood /
// palette-only changes still fire immediately.
const SEMANTIC_THRESHOLD_VOICE = 0.1;
const SECTION_DELTA_THRESHOLD = 0.5;
const SECTION_SUSTAIN_MS = 500;

// When audio has been effectively silent for this long we assume the song
// ended / the tab changed and we clear nowPlaying so the next active segment
// can re-identify. Server is the source of truth for scene.nowPlaying; the
// client has a mirror gate purely to stop its own auto-firing.
const NOW_PLAYING_SILENCE_CLEAR_MS = 10_000;
const RMS_SILENT = 0.02;

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
  readonly userId: string;
  /** BYOK fal.ai key — if set, fal calls are billed to user, credit gate skipped. */
  private byokFalKey: string | null = null;
  private scene: DreamSceneState;
  private lastGeneratedScene: DreamSceneState;
  private activeJob?: AbortController;
  private activeVersion = 0;
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private lastKeyframeAt = 0;
  private readonly publisher = new EventPublisher<{ event: ServerEvent }>();
  private readonly logger: Logger;

  private send(event: ServerEvent): void {
    this.publisher.publish("event", event);
  }

  subscribe(signal?: AbortSignal): AsyncGenerator<ServerEvent> {
    return this.publisher.subscribe("event", signal ? { signal } : undefined);
  }

  private seed: number = rollSeed();
  private heroImageUrl: string | null = null;

  private lastSectionEnergy = 0;
  private sectionDeltaStartedAt: number | null = null;
  private lastAudioAt = 0;
  private lastValence = 0.5;
  private lastArousal = 0;
  private lastBpm = 0;
  private lastFlatness = 0;
  private silentSinceAt: number | null = null;
  private recognitionInFlight: AbortController | null = null;

  private voiceBuffer: { text: string; at: number }[] = [];
  private currentAtmosphere: string | null = null;
  private currentAtmosphereAt = 0;
  private sessionStartAt = Date.now();
  private voiceInFlight?: AbortController;
  private voiceDebounceTimer?: ReturnType<typeof setTimeout>;
  private lastCreditDenialAt = 0;

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.userId = opts.userId;
    this.logger = opts.logger.child({
      sessionId: opts.id,
      userId: opts.userId,
    });
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.startPeriodic();
  }

  init(opts?: { falKey?: string }): void {
    if (opts?.falKey) {
      this.byokFalKey = opts.falKey;
      this.logger.info("BYOK fal key active for this session");
    }
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
    const now = Date.now();
    this.lastAudioAt = now;
    this.lastValence = features.valence;
    this.lastArousal = features.arousal;
    this.lastBpm = features.bpm;
    this.lastFlatness = features.flatness;

    // Silence-clear for nowPlaying. Kept independent of section detection
    // because sectionEnergy is EMA-smoothed and lags actual silence.
    if (features.rms < RMS_SILENT) {
      if (this.silentSinceAt === null) this.silentSinceAt = now;
      if (
        this.scene.nowPlaying &&
        now - this.silentSinceAt > NOW_PLAYING_SILENCE_CLEAR_MS
      ) {
        this.logger.info(
          { title: this.scene.nowPlaying.title },
          "silence sustained — clearing nowPlaying",
        );
        this.scene = { ...this.scene, nowPlaying: undefined };
        this.send({ type: "scene.state", state: this.scene });
        this.send({
          type: "now.playing",
          track: null,
          source: "audd",
          trigger: "auto",
        });
      }
    } else {
      this.silentSinceAt = null;
    }

    const delta = Math.abs(features.sectionEnergy - this.lastSectionEnergy);
    if (delta > SECTION_DELTA_THRESHOLD) {
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

  async recognize(
    clipBase64: string,
    mimeType: string,
    trigger: "auto" | "manual",
  ): Promise<NowPlaying | null> {
    // Auto-trigger dedupe: if we already know a song, don't burn an AudD
    // call. Manual always goes through so the user can force a refresh.
    if (trigger === "auto" && this.scene.nowPlaying) {
      this.logger.debug(
        { title: this.scene.nowPlaying.title },
        "recognize: nowPlaying already set, skipping auto",
      );
      return this.scene.nowPlaying;
    }
    this.recognitionInFlight?.abort();
    const controller = new AbortController();
    this.recognitionInFlight = controller;

    let outcome: Awaited<ReturnType<typeof recognizeClip>>;
    try {
      outcome = await recognizeClip(clipBase64, mimeType, this.logger);
    } catch (err) {
      this.logger.warn({ err }, "recognize: threw");
      return null;
    } finally {
      if (this.recognitionInFlight === controller) {
        this.recognitionInFlight = null;
      }
    }

    if (controller.signal.aborted) return null;

    const { track, source } = outcome;

    this.logger.info(
      {
        trigger,
        source,
        matched: Boolean(track),
        title: track?.title,
        artist: track?.artist,
      },
      "recognize: result",
    );

    this.send({ type: "now.playing", track, source, trigger });

    if (!track) return null;

    // Apply nowPlaying + deterministic scene-field backfill (only fills
    // fields that still match defaultScene — user-authored wins).
    const { patch } = mergeNowPlayingIntoScene(this.scene, track, {
      valence: this.lastValence,
      arousal: this.lastArousal,
      bpm: this.lastBpm,
      flatness: this.lastFlatness,
    });
    this.scene = { ...this.scene, ...patch, nowPlaying: track };
    this.send({ type: "scene.state", state: this.scene });

    // Fire a regeneration so the new subject/mood/palette lands immediately.
    // "section" is the closest semantic match ("the song changed").
    this.trigger("section");
    return track;
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
          nowPlaying: this.scene.nowPlaying ?? null,
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
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
      this.pauseTimer = undefined;
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
      this.periodicTimer = undefined;
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
    this.silentSinceAt = null;
    this.recognitionInFlight?.abort();
    this.recognitionInFlight = null;
    this.startPeriodic();
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "now.playing", track: null, source: "audd", trigger: "auto" });
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

  private async trigger(reason: TriggerReason): Promise<void> {
    const basePrompt = buildPrompt(this.scene);
    if (!basePrompt.trim()) {
      this.logger.debug({ reason }, "trigger skipped: empty prompt");
      return;
    }

    const forCommit = reason === "commit";

    // Credit gate. BYOK-key sessions skip it entirely (user pays fal).
    // Paid debit tries first; flow-tier also has a small free-tier fallback
    // (commits always cost credits).
    //
    // Error-spam rule: periodic / section triggers fire on a 3–5s timer and
    // would flood the client with duplicate "Out of credits" toasts. Emit
    // the job.status error only on user-initiated reasons, or on the first
    // denial of an auto-trigger reason once per CREDIT_DENIAL_COOLDOWN_MS.
    const USER_INITIATED: TriggerReason[] = [
      "commit",
      "voice",
      "semantic",
      "pause",
    ];
    const isUserInitiated = USER_INITIATED.includes(reason);

    if (!this.byokFalKey) {
      try {
        const kind: FrameKind = forCommit ? "commit" : "frame";
        const remaining = await debitFrame(this.userId, kind, this.logger);
        if (remaining === null) {
          const freeOk =
            !forCommit &&
            (await tryConsumeFreeTier(this.userId, 3, this.logger));
          if (!freeOk) {
            this.logger.info({ reason, kind }, "trigger denied: no credits");
            const now = Date.now();
            const shouldEmit =
              isUserInitiated ||
              now - this.lastCreditDenialAt > CREDIT_DENIAL_COOLDOWN_MS;
            if (shouldEmit) {
              this.lastCreditDenialAt = now;
              this.send({
                type: "job.status",
                status: "error",
                reason,
                message: forCommit
                  ? "Out of commit credits — top up to continue"
                  : "Out of credits — top up or enable BYOK",
              });
            }
            return;
          }
          this.logger.debug({ reason }, "free-tier slot consumed");
        } else {
          // Successful debit clears the denial window — fresh errors surface
          // again if credits run out later in the same session.
          this.lastCreditDenialAt = 0;
          this.logger.debug({ reason, kind, remaining }, "credit debited");
        }
      } catch (err) {
        this.logger.error(
          { err, reason },
          "credit gate errored; aborting trigger",
        );
        this.send({
          type: "job.status",
          status: "error",
          reason,
          message: "Payment system unavailable",
        });
        return;
      }
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
    // Reference-image precedence: committed hero image > album art from the
    // identified song > nothing. User voice/text commits produce a hero and
    // that always wins; album art is a zero-effort visual anchor for the
    // very first frames of a newly-identified song.
    const albumArt = this.scene.nowPlaying?.albumArtUrl;
    const nextReferences = this.heroImageUrl
      ? [this.heroImageUrl]
      : albumArt
        ? [albumArt]
        : [];
    this.scene = { ...this.scene, version, references: nextReferences };
    const snapshot: DreamSceneState = this.scene;

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

    // Morph-chain decision. We upgrade to a chain when the viewer should see
    // the change happen (voice, or a big semantic rewrite) AND we have a
    // hero to use as the img2img anchor. Commits always go single-shot — the
    // commit tier is the identity anchor, a chain there would blur it.
    const heroForChain = this.heroImageUrl;
    const diffFromLast = semanticDiff(this.lastGeneratedScene, this.scene);
    const chainCandidate =
      !forCommit &&
      heroForChain !== null &&
      (reason === "voice" || diffFromLast > MORPH_CHAIN_DIFF_THRESHOLD);

    let chainSteps = 0;
    if (chainCandidate) {
      if (this.byokFalKey) {
        chainSteps = MORPH_CHAIN_STEPS;
      } else {
        // First credit already debited above. Try to reserve the remaining
        // N-1. Whatever we can pay for is what we'll actually generate; any
        // partial reservation (0..N-1) falls back to the single-frame path
        // or short chain as appropriate.
        let extra = 0;
        for (let i = 0; i < MORPH_CHAIN_STEPS - 1; i++) {
          try {
            const rem = await debitFrame(this.userId, "frame", this.logger);
            if (rem === null) break;
            extra += 1;
          } catch (err) {
            this.logger.warn({ err, i }, "morph chain extra-debit errored");
            break;
          }
        }
        chainSteps = extra >= 1 ? 1 + extra : 0;
      }
    }

    if (chainSteps >= 2 && heroForChain !== null) {
      const fromPrompt = buildPrompt(this.lastGeneratedScene) || prompt;
      this.logger.info(
        { steps: chainSteps, diffFromLast, fromPrompt, toPrompt: prompt },
        "morph chain start",
      );
      streamMorphChain({
        fromPrompt,
        toPrompt: prompt,
        heroImageUrl: heroForChain,
        steps: chainSteps,
        seed: this.seed,
        falKey: this.byokFalKey ?? undefined,
        signal: controller.signal,
        logger: this.logger,
        onStep: (url, index, total) => {
          if (version !== this.activeVersion) return;
          this.send({
            type: "frame.final",
            imageUrl: url,
            version,
            chainIndex: index,
            chainLength: total,
          });
          if (index === total - 1) {
            this.lastGeneratedScene = snapshot;
            this.send({ type: "job.status", status: "idle" });
          }
        },
        onError: (err) => {
          if (controller.signal.aborted) return;
          this.logger.error({ err }, "morph chain error");
          this.send({
            type: "job.status",
            status: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        },
      }).catch((err) => {
        if (!controller.signal.aborted) {
          this.logger.error({ err }, "streamMorphChain unhandled");
        }
      });
      return;
    }

    streamPreview({
      prompt,
      referenceImages: nextReferences,
      seed: this.seed,
      forCommit,
      falKey: this.byokFalKey ?? undefined,
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
