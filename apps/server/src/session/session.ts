import {
  type AudioFeatures,
  type ClientScenePatch,
  type DreamSceneState,
  type NowPlaying,
  type ServerEvent,
  defaultScene,
} from "@music-visualizer/shared";
import { EventPublisher } from "@orpc/server";
import type { Logger } from "../lib/logger";
import { streamPreview } from "../generation/fal-provider";
import { serializeResolvedScene } from "../generation/prompt-compiler";
import { DriftTrajectory, sampleDriftLayered } from "../generation/prompt-drift";
import { resolveScene } from "../generation/scene-resolver";
import {
  debitFrame,
  refundFrame,
  tryConsumeFreeTier,
  type FrameKind,
} from "../credits/credits-service";
import { recognizeClip } from "../recognition/recognition-service";
import {
  synthesizeFromTrack,
  type SongMusePatch,
} from "../generation/song-muse";
import { SttService } from "../recognition/stt/stt-service";
import { mergeNowPlayingIntoScene } from "./now-playing-merge";
import { semanticDiff } from "./semantic-diff";
import { VoiceController } from "./voice-controller";

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

// Full-arc length. sessionProgress = min(1, (now - sessionStartAt) / SESSION_ARC_MS).
// Drives: drift-pool act bias (intro/build/dissolve weights in prompt-drift).
// Also exposed on the client over scene.state so the renderer can modulate
// trail decay, glitch-peek cadence, and a subtle palette-temp over the arc.
const SESSION_ARC_MS = 20 * 60_000;

// Baseline thresholds. PERIODIC_MS and PAUSE_MS are intensity-derived
// (see cadenceFromIntensity below). 0.4 (raised from 0.3 in phase 3) reduces
// re-triggers for tiny prompt edits now that the periodic cadence is slower
// and per-trigger cost is felt more.
const SEMANTIC_THRESHOLD = 0.4;

// After the first "out of credits" error on an auto-trigger (periodic /
// section), suppress further errors for this long before re-emitting.
// User-initiated triggers (commit / voice / semantic / pause) always emit.
const CREDIT_DENIAL_COOLDOWN_MS = 60_000;
// When a patch arrives via voice, drop the trigger threshold so mood /
// palette-only changes still fire immediately.
const SEMANTIC_THRESHOLD_VOICE = 0.1;
const SECTION_DELTA_THRESHOLD = 0.5;
const SECTION_SUSTAIN_MS = 500;
// Refractory window after a section trigger fires. Without this, a
// chorus-into-bridge transition could produce three section triggers in 2s
// because sectionEnergy oscillates around the smoothed midpoint while it
// re-stabilises. 12s matches the new keyframe base cadence so we never
// stack two image generations on top of each other for energy reasons.
const SECTION_REFRACTORY_MS = 12_000;

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
//
// Phase 3 raised the periodic floor from 3-7s to 8-16s. The per-frame audio
// reactivity already lives in the client shader (uBass/uMids/uTreble drive
// displacement, bloom, hue every render frame), so slowing the cadence saves
// FAL credits without making the visual feel less alive. pauseMs unchanged —
// the user still wants snappy feedback after a deliberate edit.
function cadenceFromIntensity(i: number): { periodicMs: number; pauseMs: number } {
  const I = Math.max(0, Math.min(1, i));
  return {
    periodicMs: Math.round(lerp(16_000, 8_000, I)),
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
  private lastSectionTriggerAt = 0;
  private lastAudioAt = 0;
  private lastValence = 0.5;
  private lastArousal = 0;
  private lastBpm = 0;
  private lastFlatness = 0;
  private silentSinceAt: number | null = null;
  private recognitionInFlight: AbortController | null = null;

  private sessionStartAt = Date.now();
  private lastCreditDenialAt = 0;

  // Voice input mode. "live" = always-on VAD (Flux decides end-of-turn);
  // "ptt" = mic only forwards to Flux while the client holds SPACE (see
  // `pttStart`/`pttEnd`). Defaults to PTT — safer in multi-person rooms
  // where ambient speech otherwise triggers false commits.
  private voiceMode: "live" | "ptt" = "ptt";

  // Stateful per-keyframe drift sequence. Reseeded whenever the resolver
  // returns fresh LLM-generated drift_candidates (i.e., scene-hash changed).
  // Falls back to the curated static pool until the first LLM cache fill.
  private readonly driftTrajectory = new DriftTrajectory();

  private readonly voice: VoiceController;
  private readonly stt: SttService;

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.userId = opts.userId;
    this.logger = opts.logger.child({
      sessionId: opts.id,
      userId: opts.userId,
    });
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    this.voice = new VoiceController({
      logger: this.logger,
      send: (event) => this.send(event),
      getSceneForIntent: () => ({
        subject: this.scene.subject,
        environment: this.scene.environment,
        mood: this.scene.mood,
        palette: this.scene.palette,
        intensity: this.scene.intensity,
      }),
      getLiveMood: () => ({
        valence: this.lastValence,
        arousal: this.lastArousal,
      }),
      getNowPlaying: () => this.scene.nowPlaying ?? null,
      applyPatch: (patch, origin) => this.applyPatch(patch, origin),
      commit: () => this.commit(),
      getActiveVersion: () => this.activeVersion,
    });
    this.stt = new SttService({
      logger: this.logger,
      // STT partials/finals route through the same VoiceController surface
      // as Web Speech client-pushed partials, so the trail UI sees the
      // same voice.partial → voice.parsed → voice.applied chain regardless
      // of provider.
      onPartial: (opts) => this.voice.applyPartial(opts),
      // Flux emits EndOfTurn when it's highly confident the speaker is done.
      // Flush the VoiceController debounce so the LLM intent dispatches
      // immediately (Live mode); PTT mode reaches commitNow via ptt.end.
      onEndOfTurn: ({ transcript, confidence }) => {
        this.logger.debug(
          { transcript, confidence },
          "stt: end-of-turn, flushing voice debounce",
        );
        this.voice.commitNow();
      },
    });
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

  // Idempotent snapshot of server-authoritative state for the client's
  // bootstrap pull (see session.router state procedure). Kept tiny on
  // purpose — the rest flows through the events stream.
  getSnapshot(): DreamSceneState {
    return this.scene;
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
        if (now - this.lastSectionTriggerAt >= SECTION_REFRACTORY_MS) {
          this.lastSectionTriggerAt = now;
          this.trigger("section");
        }
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
    // Deterministic merge handles mood/palette/camera/intensity. Subject is
    // intentionally NOT set here; the LLM muse below synthesizes an evocative
    // sumi-e subject that abstracts the song rather than quoting its title.
    const { patch } = mergeNowPlayingIntoScene(this.scene, track, {
      valence: this.lastValence,
      arousal: this.lastArousal,
      bpm: this.lastBpm,
      flatness: this.lastFlatness,
    });
    this.scene = { ...this.scene, ...patch, nowPlaying: track };
    this.send({ type: "scene.state", state: this.scene });

    // LLM muse — translate the track into an evocative visual scene.
    // Awaited so we fire a single trigger with a good subject instead of
    // triggering twice (once for the deterministic fill, once for the muse).
    // ~1-2s on gemini-2.5-flash-lite; user is already waiting on the identify
    // click. Failures fall through to `track.title` as a last-resort subject.
    let muse: SongMusePatch | null = null;
    try {
      muse = await synthesizeFromTrack(
        {
          track,
          valence: this.lastValence,
          arousal: this.lastArousal,
          bpm: this.lastBpm,
        },
        { signal: controller.signal, logger: this.logger },
      );
    } catch (err) {
      this.logger.warn({ err }, "song-muse: unhandled");
    }
    if (controller.signal.aborted) return null;

    const museExtra: Partial<DreamSceneState> = {};
    if (muse?.subject && this.scene.subject === defaultScene.subject) {
      museExtra.subject = muse.subject;
    }
    if (muse?.environment && this.scene.environment === defaultScene.environment) {
      museExtra.environment = muse.environment;
    }
    if (muse?.action && this.scene.action === defaultScene.action) {
      museExtra.action = muse.action;
    }
    if (muse?.mood && this.scene.mood === defaultScene.mood) {
      museExtra.mood = muse.mood;
    }
    // Fallback so the trigger below actually fires: if the muse failed AND
    // the user still hasn't authored a subject, at least populate it with the
    // bare title (no "Artist — Title" literal dump — that used to read as
    // quotation inside FLUX).
    if (!museExtra.subject && this.scene.subject === defaultScene.subject) {
      museExtra.subject = track.title;
    }
    if (Object.keys(museExtra).length > 0) {
      this.scene = { ...this.scene, ...museExtra };
      this.send({ type: "scene.state", state: this.scene });
      this.logger.info(
        { museExtra, hasLlmSynth: muse !== null },
        "song-muse: scene enriched",
      );
    }

    // Fire a regeneration so the new subject/mood/palette lands immediately.
    // "section" is the closest semantic match ("the song changed").
    this.trigger("section");
    return track;
  }

  commit(): void {
    this.trigger("commit");
  }

  applyVoice(text: string): void {
    this.voice.applyVoice(text);
  }

  // Live transcript ingress from a client-side STT (Web Speech) or the
  // server-side Deepgram Flux relay. Emits voice.partial back to the client
  // and — when isFinal — schedules the LLM intent dispatch via applyVoice.
  applyVoicePartial(opts: {
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "web-speech" | "deepgram";
  }): void {
    this.voice.applyPartial(opts);
  }

  // ===== Server-side STT relay (Deepgram Flux path) =====
  // No-ops when DEEPGRAM_API_KEY isn't set — the client falls back to
  // browser Web Speech and pushes finals via voicePhrase / partials via
  // voicePartial. With a key, audioStart opens the Flux WS, audioChunk pumps
  // PCM16 frames, audioStop closes. Flux emits EndOfTurn events which flush
  // the voice debounce (see SttService.onEndOfTurn wiring in constructor).
  audioStart(opts: { sampleRate: number }): void {
    // Forwarding gate defaults to the current voice mode: Live forwards
    // immediately, PTT starts closed and opens on voice.ptt.start.
    this.stt.start(opts);
    this.stt.setForwardAudio(this.voiceMode === "live");
  }
  audioStop(): void {
    this.stt.stop();
  }
  audioChunk(base64: string): void {
    this.stt.push(base64);
  }
  // Surface to the client (via session.router.state) which STT path to
  // activate. Mirrors SttService.isEnabled — never exposes the actual key.
  sttProvider(): "deepgram" | "web-speech" {
    return this.stt.isEnabled() ? "deepgram" : "web-speech";
  }

  // ===== Voice mode + PTT =====
  // Live mode: always forward audio → Flux commits on its own EndOfTurn.
  // PTT  mode: forward only while ptt is held; on release flush the voice
  // debounce so the current utterance dispatches immediately regardless of
  // whether Flux has reached its EOT threshold yet.
  setVoiceMode(mode: "live" | "ptt"): void {
    if (this.voiceMode === mode) return;
    this.voiceMode = mode;
    this.logger.info({ mode }, "voice mode changed");
    // When flipping to Live, audio flows immediately. When flipping to PTT,
    // close the gate until the next ptt.start — any in-flight utterance is
    // left to finish naturally (Flux will send EndOfTurn or time out).
    this.stt.setForwardAudio(mode === "live");
  }

  pttStart(): void {
    if (this.voiceMode !== "ptt") return;
    this.logger.debug("voice ptt start");
    this.stt.setForwardAudio(true);
  }

  pttEnd(): void {
    if (this.voiceMode !== "ptt") return;
    this.logger.debug("voice ptt end");
    // Dispatch the LLM intent immediately. Done before the gate closes so
    // `commitNow` can still read the freshest partial transcript — and so
    // trailing audio still in flight from the client reaches Flux, letting
    // it emit a real EndOfTurn for the trail UI afterwards.
    this.voice.commitNow();
    setTimeout(() => this.stt.setForwardAudio(false), 250);
  }

  reset(): void {
    this.activeJob?.abort();
    this.voice.reset();
    this.stt.stop();
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
    this.voice.close();
    this.stt.stop();
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

  private async trigger(reason: TriggerReason): Promise<void> {
    // Empty-subject fast-exit. `serializeResolvedScene` also returns "" when
    // subjects[0] is blank, but short-circuiting here saves the resolver and
    // credit-gate work when there's nothing to generate.
    if (!this.scene.subject.trim()) {
      this.logger.debug({ reason }, "trigger skipped: empty subject");
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

    // Tracks the column to refund into if the fal call fails after we paid.
    // Stays null on BYOK and free-tier paths (which we never refund).
    let paidKind: FrameKind | null = null;

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
          paidKind = kind;
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
    const latestVoice = this.voice.getLatestVoice();
    const atmosphere = this.voice.getAtmosphere();
    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS,
    );
    const drift = sampleDriftLayered({
      llmDrift: atmosphere,
      latestVoice,
      trajectory: this.driftTrajectory,
      sessionProgress,
    });
    const driftSource: "llm" | "voice" | "pool" | "none" = atmosphere
      ? "llm"
      : latestVoice
        ? "voice"
        : drift
          ? "pool"
          : "none";

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

    // Resolve the flat scene into the structured ResolvedScene, then serialise
    // to the FLUX prompt. Single source of truth: the inspector HUD's
    // `promptString` and `resolvedScene` both come from this one build.
    const resolved = resolveScene(this.scene, {
      driftModifiers: drift ? [drift] : [],
      audio: {
        intensity: this.scene.intensity,
        section: this.lastSectionEnergy,
        energyDelta: 0,
      },
      logger: this.logger,
    });
    // Reseed the drift trajectory whenever fresh LLM candidates land. Same-
    // pool calls are no-ops (trajectory checks pool equality), so this is
    // safe to call on every trigger.
    if (resolved.drift_candidates.length > 0) {
      const reseeded = this.driftTrajectory.reseed({
        candidates: resolved.drift_candidates,
        sessionProgress,
      });
      if (reseeded) {
        this.logger.debug(
          { candidates: resolved.drift_candidates.length },
          "drift trajectory reseeded",
        );
      }
    }
    const prompt = serializeResolvedScene(resolved);
    if (!prompt.trim()) {
      // Shouldn't happen — the empty-subject guard at the top already caught
      // the most common case. Logged at debug so a future serializer bug
      // surfaces instead of silently firing an empty FAL request.
      this.logger.debug(
        { reason, resolved },
        "trigger skipped: empty resolved prompt",
      );
      return;
    }

    this.logger.info(
      {
        reason,
        version,
        prompt,
        drift,
        driftSource,
        sessionProgress: Number(sessionProgress.toFixed(2)),
        seed: this.seed,
        hasHero: this.heroImageUrl !== null,
        tier: forCommit ? "commit" : "flow",
      },
      "trigger fire",
    );
    this.send({ type: "job.status", status: "running", reason });
    this.lastKeyframeAt = Date.now();

    const requestedAt = Date.now();
    const { periodicMs } = cadenceFromIntensity(this.scene.intensity);
    this.send({
      type: "generation.requested",
      reason,
      version,
      promptString: prompt,
      driftSource,
      resolvedScene: resolved,
      requestedAt,
      nextKeyframeAt: this.lastKeyframeAt + periodicMs,
    });

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
        this.send({
          type: "generation.completed",
          version,
          durationMs: Date.now() - requestedAt,
          success: true,
        });
      },
      onError: (err) => {
        // Refund the paid credit before surfacing the error. Free-tier and
        // BYOK paths set paidKind=null so this is a no-op for them. Aborts
        // refund too — a superseded trigger never delivered a frame, so
        // the user should get the credit back regardless of the cause.
        if (paidKind) {
          refundFrame(this.userId, paidKind, this.logger).catch((e) => {
            this.logger.error(
              { err: e, version, kind: paidKind },
              "refundFrame after fal error failed",
            );
          });
        }
        if (controller.signal.aborted) return;
        this.logger.error({ err }, "fal stream error");
        const message = err instanceof Error ? err.message : String(err);
        this.send({
          type: "job.status",
          status: "error",
          message,
        });
        this.send({
          type: "generation.completed",
          version,
          durationMs: Date.now() - requestedAt,
          success: false,
          message,
        });
      },
    }).catch((err) => {
      if (!controller.signal.aborted) {
        this.logger.error({ err }, "streamPreview unhandled");
      }
    });
  }
}
