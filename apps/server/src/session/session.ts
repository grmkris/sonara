import {
  type AudioFeatures,
  type ClientScenePatch,
  type DeckKey,
  type ImageAnchor,
  type SonaraSceneState,
  type NowPlaying,
  type ServerEvent,
  DECK_KEYS,
  defaultScene,
} from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { EventPublisher } from "@orpc/server";
import type { Logger } from "../lib/logger";
import { streamPreview } from "../generation/fal-provider";
import { streamAnchor } from "../generation/anchor-provider";
import { pickLibraryFrame } from "../generation/library-provider";
import { serializeResolvedScene } from "../generation/prompt-compiler";
import { DriftTrajectory } from "../generation/prompt-drift";
import { resolveScene } from "../generation/scene-resolver";
import {
  ANCHOR_FRAME_COST_CREDITS,
  refundOnError,
  tryDebitCredit,
} from "../credits/credit-gate";
import { recognizeClip } from "../recognition/recognition.service";
import {
  synthesizeFromTrack,
  type SongMusePatch,
} from "../generation/song-muse";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  // raw UUID for authenticated sessions; null for anonymous demo sessions.
  // Anon sessions are pinned to library-only mode (no fal, no credit debit,
  // no AudD recognition) — see constructor + trigger() + recognize().
  userId: string | null;
  logger: Logger;
}

// `source` is the granular reason a trigger fired — used only for logging and
// for the wire field that drives the trigger-log UI. Dispatch logic (cooldown
// suppression, credit-gate) keys off `kind` instead, which collapses the five
// reasons into the only distinction that actually matters: auto-fired vs
// user-driven. Pre-collapse the surface had 6 reasons → 5; this turns the
// remaining downstream conditional into a type-level enum.
type TriggerSource = "pause" | "semantic" | "periodic" | "section" | "voice";
type TriggerKind = "auto" | "user";

const USER_INITIATED_SOURCES: ReadonlySet<TriggerSource> = new Set([
  "voice",
  "semantic",
  "pause",
]);
const kindFromSource = (source: TriggerSource): TriggerKind =>
  USER_INITIATED_SOURCES.has(source) ? "user" : "auto";

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
  readonly userId: string | null;
  private scene: SonaraSceneState;
  private lastGeneratedScene: SonaraSceneState;
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

  private lastSectionEnergy = 0;
  private sectionDeltaStartedAt: number | null = null;
  private lastSectionTriggerAt = 0;
  private lastAudioAt = 0;
  private lastValence = 0.5;
  private lastArousal = 0;
  private lastBpm = 0;
  private silentSinceAt: number | null = null;
  private recognitionInFlight: AbortController | null = null;

  private sessionStartAt = Date.now();
  private lastCreditDenialAt = 0;

  // DEMO mode — when on, trigger() pulls a row from image_library instead of
  // calling fal. `recentLibraryPicks` is a small LRU so back-to-back triggers
  // don't repeat the same image.
  private demoMode = false;
  private demoDeck: DeckKey | null = null;
  private recentLibraryPicks: ImageLibraryId[] = [];
  private static readonly LIBRARY_LRU = 10;

  // Stateful per-keyframe drift sequence. Reseeded whenever the resolver
  // returns fresh LLM-generated drift_candidates (i.e., scene-hash changed).
  // Falls back to the curated static pool until the first LLM cache fill.
  private readonly driftTrajectory = new DriftTrajectory();

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.userId = opts.userId;
    this.logger = opts.logger.child({
      sessionId: opts.id,
      userId: opts.userId,
      anon: opts.userId === null,
    });
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    // Anonymous sessions are pinned to demo mode for the lifetime of the WS
    // connection. trigger() short-circuits to triggerLibrary() at the top
    // whenever demoMode && demoDeck, so anon never reaches credit-gate or fal.
    // Deck is picked at random on connect — setDemoMode() can still swap it
    // (the deck picker is harmless without a userId).
    if (opts.userId === null) {
      this.demoMode = true;
      this.demoDeck = DECK_KEYS[Math.floor(Math.random() * DECK_KEYS.length)] ?? null;
    }
    this.startPeriodic();
  }

  init(): void {
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "job.status", status: "idle" });
  }

  // Idempotent snapshot of server-authoritative state for the client's
  // bootstrap pull (see session.router state procedure). Kept tiny on
  // purpose — the rest flows through the events stream.
  getSnapshot(): SonaraSceneState {
    return this.scene;
  }

  // Demo state accessors exposed for the bootstrap snapshot. Anon sessions
  // are constructor-pinned with demoMode=true + a random deck, and the
  // client has no other way to learn that — so the snapshot carries it.
  isDemoMode(): boolean {
    return this.demoMode;
  }

  getDemoDeck(): DeckKey | null {
    return this.demoDeck;
  }

  getImageAnchor(): ImageAnchor | null {
    return this.scene.imageAnchor ?? null;
  }

  // Set or clear the live session's image anchor. Setting clears demoMode
  // (anchor and demo are mutually exclusive — anchor wins). Fires a trigger
  // immediately so the first anchor frame lands without waiting for the
  // semantic-diff gate.
  setImageAnchor(
    input: { url: string; strength: number } | { clear: true },
  ): void {
    if ("clear" in input) {
      if (!this.scene.imageAnchor) return;
      this.scene = { ...this.scene, imageAnchor: undefined };
      this.send({ type: "scene.state", state: this.scene });
      this.logger.info({}, "image anchor cleared");
      return;
    }
    // Anchor wins over demo. setDemoMode doesn't touch anchor; if both are
    // attempted to be set simultaneously, the most recent mutation lands.
    if (this.demoMode) {
      this.demoMode = false;
    }
    this.scene = {
      ...this.scene,
      imageAnchor: { url: input.url, strength: input.strength },
    };
    this.send({ type: "scene.state", state: this.scene });
    this.logger.info(
      { url: input.url, strength: input.strength },
      "image anchor set",
    );
    // Fire trigger immediately — bypasses semantic-diff gate so the first
    // anchor frame lands without waiting.
    void this.trigger("semantic");
  }

  applyPatch(
    patch: ClientScenePatch,
    origin: "client" | "voice" = "client",
  ): void {
    const next: SonaraSceneState = { ...this.scene, ...patch };
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
    // Anonymous sessions never call AudD or the LLM muse — both have
    // per-call cost and the demo loop doesn't need song titles. The UI
    // hides the now-playing trigger for anon already; this is defence in
    // depth in case a stale client posts here anyway.
    if (this.userId === null) return null;
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

    // Pin nowPlaying to the scene so the HUD can show it. Track metadata no
    // longer auto-fills scene fields deterministically — the LLM muse below
    // synthesises a single evocative prompt that abstracts the song, and
    // overwrites scene.prompt only when the user hasn't authored their own.
    this.scene = { ...this.scene, nowPlaying: track };
    this.send({ type: "scene.state", state: this.scene });

    // LLM muse — translate the track into an evocative visual prompt sentence.
    // Awaited so we fire a single trigger with the synthesised prompt instead
    // of triggering twice. ~1-2s on gemini-2.5-flash-lite; user is already
    // waiting on the identify click. Failures fall through to `track.title`
    // as a last-resort prompt.
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

    // Only fill the prompt slot if the user hasn't typed their own. "Hasn't
    // typed" === scene.prompt still matches defaultScene.prompt (""). Voice
    // dictation also writes through scene.prompt, so this respects spoken
    // input the same as typed input.
    const userHasPrompt = this.scene.prompt !== defaultScene.prompt;
    if (!userHasPrompt) {
      // Prefer the LLM's evocative one-liner; fall back to the bare track
      // title if the muse failed (no "Artist — Title" literal dump — that
      // used to read as quotation inside FLUX).
      const nextPrompt = muse?.prompt?.trim() || track.title;
      this.scene = { ...this.scene, prompt: nextPrompt };
      this.send({ type: "scene.state", state: this.scene });
      this.logger.info(
        { prompt: nextPrompt, hasLlmSynth: muse !== null },
        "song-muse: scene enriched",
      );
    }

    // Fire a regeneration so the new prompt lands immediately. "section" is
    // the closest semantic match ("the song changed").
    this.trigger("section");
    return track;
  }

  setDemoMode(on: boolean, deck: DeckKey | null): void {
    // Anonymous sessions can switch decks but cannot leave demo mode. Letting
    // them flip demoMode off would push trigger() into the fal path, where
    // the userId-null guard would refuse to generate — the visualiser would
    // just stop. Pin them on; the UI hides the Switch for anon anyway.
    if (this.userId === null && !on) {
      this.logger.info({}, "anon setDemoMode(false) ignored — pinned on");
      return;
    }
    this.demoMode = on;
    this.demoDeck = on ? deck : null;
    // Reset the LRU exclude-set so a deck switch can re-pick from scratch.
    this.recentLibraryPicks = [];
    this.logger.info({ demoMode: on, demoDeck: this.demoDeck }, "demo mode set");
    // Kill the up-to-16s wait between toggling DEMO on and seeing the first
    // library frame. trigger() short-circuits into triggerLibrary() at the
    // top, so this is one library pick without any fal involvement.
    if (on && deck) {
      void this.trigger("semantic");
    }
  }

  reset(): void {
    this.activeJob?.abort();
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
    this.sessionStartAt = Date.now();
    this.silentSinceAt = null;
    this.recentLibraryPicks = [];
    this.recognitionInFlight?.abort();
    this.recognitionInFlight = null;
    this.startPeriodic();
    this.send({ type: "scene.state", state: this.scene });
    this.send({ type: "now.playing", track: null, source: "audd", trigger: "auto" });
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
      const hasScene = this.scene.prompt.trim().length > 0;
      const hasDemo = this.demoMode && this.demoDeck !== null;
      if (!hasAudio && !hasScene && !hasDemo) return;
      this.trigger("periodic");
    }, 1000);
  }

  private async trigger(source: TriggerSource): Promise<void> {
    const kind = kindFromSource(source);
    // Keep `reason` for log + event compatibility — it goes on the wire as
    // part of `job.status` / `generation.requested`.
    const reason = source;

    // DEMO mode short-circuit. Library frames bypass the empty-subject
    // guard (the user may not have typed anything), the credit gate, the
    // prompt resolver, and fal entirely. The library_provider returns null
    // when the deck is empty → fall through to the normal fal path.
    if (this.demoMode && this.demoDeck) {
      this.lastKeyframeAt = Date.now();
      await this.triggerLibrary(reason);
      return;
    }

    // Image-anchor short-circuit. When the user has pinned an uploaded
    // image as a reference, route to flux-pro/v1.1-ultra with image_url
    // conditioning instead of klein/9b. Distinct credit cost; same
    // crossfade + observability events on the wire.
    if (this.scene.imageAnchor) {
      this.lastKeyframeAt = Date.now();
      await this.triggerAnchor(reason);
      return;
    }

    // Defence in depth. The constructor pins anon sessions to demoMode=true
    // with a deck, so the short-circuit above always catches them. If that
    // invariant ever breaks (someone clears demoMode programmatically), we
    // refuse to enter the paid path rather than billing a phantom user.
    if (this.userId === null) {
      this.logger.warn({ reason }, "anon trigger reached fal path — bailing");
      return;
    }
    const userId = this.userId;

    // Empty-prompt fast-exit. `serializeResolvedScene` also returns "" when
    // subjects[0] is blank, but short-circuiting here saves the resolver and
    // credit-gate work when there's nothing to generate.
    if (!this.scene.prompt.trim()) {
      this.logger.debug({ reason }, "trigger skipped: empty prompt");
      return;
    }

    // Close the periodic-gate window IMMEDIATELY. The credit debit + fal
    // setup below are async; without this, every 1s periodic tick fires
    // another trigger before lastKeyframeAt was updated, stacking parallel
    // generations and double-debiting credits.
    this.lastKeyframeAt = Date.now();

    const gate = await tryDebitCredit({
      userId,
      isUserInitiated: kind === "user",
      lastCreditDenialAt: this.lastCreditDenialAt,
      now: Date.now(),
      logger: this.logger,
    });
    this.lastCreditDenialAt = gate.nextLastDenialAt;

    if (!gate.ok) {
      this.logger.info(
        { reason, gateReason: gate.reason },
        "trigger denied",
      );
      if (gate.shouldEmit) {
        this.send({
          type: "job.status",
          status: "error",
          reason,
          message:
            gate.reason === "system_error"
              ? "Payment system unavailable"
              : "Out of credits — top up to keep generating",
        });
      }
      return;
    }

    const paidCost = gate.paidCost;

    // Drift modifier. Trajectory is LLM-seeded when scene-llm-expander has
    // filled drift_candidates; otherwise it walks the curated static pool.
    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS,
    );
    const drift = this.driftTrajectory.next();
    const driftSource: "pool" | "none" = drift ? "pool" : "none";

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;

    this.activeVersion += 1;
    const version = this.activeVersion;
    // Every keyframe is a fresh text-to-image generation. No reference
    // image, no identity lock — prompt changes take effect on the very
    // next frame.
    this.scene = { ...this.scene, version };
    const snapshot: SonaraSceneState = this.scene;

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
      },
      "trigger fire",
    );
    this.send({ type: "job.status", status: "running", reason });

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
        // Refund regardless of abort — fal-provider routes superseded
        // generations through onError too, and the user should get the
        // credit back since no frame was delivered. Free-tier paths set
        // paidCost=null so this is a no-op for them.
        refundOnError(userId, paidCost, this.logger);
        // Aborts are expected (newer trigger superseded this one). Don't
        // log noisily or surface to the client.
        if (controller.signal.aborted) return;
        this.logger.error({ err }, "generation failed");
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

  // Image-anchor-mode trigger. Calls fal flux-pro/v1.1-ultra with the user's
  // uploaded image conditioning the output. Emits the same crossfade events
  // as the text-mode path so the client doesn't need to distinguish.
  private async triggerAnchor(source: TriggerSource): Promise<void> {
    const anchor = this.scene.imageAnchor;
    if (!anchor) return;

    // Anon defence in depth — the upload route is authed-only, but if a
    // null userId somehow reached this path we refuse to bill phantom.
    if (this.userId === null) {
      this.logger.warn({ source }, "anon trigger reached anchor path — bailing");
      return;
    }
    const userId = this.userId;
    const kind = kindFromSource(source);
    const reason = source;

    const gate = await tryDebitCredit({
      userId,
      isUserInitiated: kind === "user",
      lastCreditDenialAt: this.lastCreditDenialAt,
      now: Date.now(),
      logger: this.logger,
      cost: ANCHOR_FRAME_COST_CREDITS,
    });
    this.lastCreditDenialAt = gate.nextLastDenialAt;

    if (!gate.ok) {
      this.logger.info(
        { reason, gateReason: gate.reason, cost: ANCHOR_FRAME_COST_CREDITS },
        "anchor trigger denied",
      );
      if (gate.shouldEmit) {
        this.send({
          type: "job.status",
          status: "error",
          reason,
          message:
            gate.reason === "system_error"
              ? "Payment system unavailable"
              : "Out of credits — top up to keep generating",
        });
      }
      return;
    }
    const paidCost = gate.paidCost;

    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS,
    );
    const drift = this.driftTrajectory.next();
    const driftSource: "pool" | "none" = drift ? "pool" : "none";

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;

    this.activeVersion += 1;
    const version = this.activeVersion;
    this.scene = { ...this.scene, version };
    const snapshot: SonaraSceneState = this.scene;

    this.send({ type: "scene.state", state: this.scene });

    // Resolve the prompt through the same LLM expander as text-mode so the
    // inspector HUD shows coherent metadata and so the drift trajectory
    // gets seeded on first call.
    const resolved = resolveScene(this.scene, {
      driftModifiers: drift ? [drift] : [],
      audio: {
        intensity: this.scene.intensity,
        section: this.lastSectionEnergy,
        energyDelta: 0,
      },
      logger: this.logger,
    });
    if (resolved.drift_candidates.length > 0) {
      this.driftTrajectory.reseed({
        candidates: resolved.drift_candidates,
        sessionProgress,
      });
    }
    const prompt = serializeResolvedScene(resolved);

    this.logger.info(
      {
        reason,
        version,
        prompt,
        anchorUrl: anchor.url,
        anchorStrength: anchor.strength,
        seed: this.seed,
      },
      "anchor trigger fire",
    );
    this.send({ type: "job.status", status: "running", reason });

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

    streamAnchor({
      prompt,
      imageUrl: anchor.url,
      strength: anchor.strength,
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
        refundOnError(userId, paidCost, this.logger);
        if (controller.signal.aborted) return;
        this.logger.error({ err }, "anchor generation failed");
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
        this.logger.error({ err }, "streamAnchor unhandled");
      }
    });
  }

  // Library-mode trigger. Picks one row from image_library, emits the same
  // frame.final / job.status / generation.completed sequence the fal path
  // emits — the client crossfade is identical. No credit debit, no fal call,
  // no prompt resolver. Empty deck emits a friendly error and stops; we do
  // NOT silently fall back to fal — the user explicitly opted out of fal by
  // entering DEMO mode, and falling back would burn credits unexpectedly.
  private async triggerLibrary(
    reason: TriggerSource,
  ): Promise<void> {
    if (!this.demoDeck) return;

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;
    this.activeVersion += 1;
    const version = this.activeVersion;
    const requestedAt = Date.now();

    const pick = await pickLibraryFrame(
      this.demoDeck,
      this.recentLibraryPicks,
      this.logger,
    );

    if (controller.signal.aborted) return;
    if (version !== this.activeVersion) return;

    if (!pick) {
      this.logger.warn(
        { deck: this.demoDeck },
        "library deck empty — emitting error, not falling back to fal",
      );
      this.activeVersion -= 1;
      this.send({
        type: "job.status",
        status: "error",
        message: `Demo deck "${this.demoDeck}" is empty — pick another deck or turn DEMO off.`,
      });
      return;
    }

    this.recentLibraryPicks = [pick.id, ...this.recentLibraryPicks].slice(
      0,
      Session.LIBRARY_LRU,
    );

    // Bump scene.version for the wire so the client renders the new image
    // through the same path as a fal frame.
    this.scene = { ...this.scene, version };
    this.lastGeneratedScene = this.scene;
    this.send({ type: "scene.state", state: this.scene });

    this.send({ type: "job.status", status: "running", reason });
    this.send({ type: "frame.final", imageUrl: pick.url, version });
    this.send({ type: "job.status", status: "idle" });
    this.send({
      type: "generation.completed",
      version,
      durationMs: Date.now() - requestedAt,
      success: true,
    });
  }
}
