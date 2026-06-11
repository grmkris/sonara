import { EventPublisher } from "@orpc/server";
import type {
  ControllableSession,
  ControlSnapshot,
  SessionSource,
  SessionSourceState,
} from "@sonara/api/server";
import {
  DEFAULT_RESOLUTION,
  DEFAULT_TEXT_MODEL,
  LISTED_DECK_KEYS,
  TEXT_MODELS,
  clampPrompt,
  deckStyle,
  defaultScene,
  libraryCadenceMs,
} from "@sonara/shared";
import type {
  AudioFeatures,
  ClientScenePatch,
  DeckKey,
  ImageAnchor,
  RenderResolution,
  SonaraSceneState,
  NowPlaying,
  ServerEvent,
  TextModelKey,
} from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type {
  ImageLibraryId,
  LiveSessionId,
  StageId,
} from "@sonara/shared/typeid";

import {
  ANCHOR_FRAME_COST_CREDITS,
  refundOnError,
  tryDebitCredit,
} from "../credits/credit-gate";
import { getPool } from "../db/pool";
import { env } from "../env";
import { streamAnchor } from "../generation/anchor-provider";
import { streamPreview } from "../generation/fal-provider";
import { serializeResolvedScene } from "../generation/prompt-compiler";
import { DriftTrajectory } from "../generation/prompt-drift";
import { RealtimeImagePool } from "../generation/realtime-provider";
import {
  resolveScene,
  resolveSceneAwaited,
} from "../generation/scene-resolver";
import { synthesizeFromTrack } from "../generation/song-muse";
import type { SongMusePatch } from "../generation/song-muse";
import type { Logger } from "../lib/logger";
import { persistFrame } from "../library/persist-frame";
import {
  appendRecordingFrame,
  ensureRecordingSet,
  finalizeRecordingSet,
} from "../library/recording-set";
import { stageRooms } from "../onchain/stage-rooms";
import { recognizeClip } from "../recognition/recognition.service";
import { semanticDiff } from "./semantic-diff";

export interface SessionOpts {
  id: string;
  // raw UUID for authenticated sessions; null for anonymous demo sessions.
  // Anon sessions are pinned to library-only mode (no fal, no credit debit,
  // no AudD recognition) — see constructor + trigger() + recognize().
  userId: string | null;
  logger: Logger;
  // Durable identifier for the logical performance, owned by the client and
  // re-sent on every (re)connect. When supplied, frames keep grouping under
  // one session_id across reconnects; absent/null (old/direct client, or an
  // unvalidated id) → fresh mint.
  liveSessionId?: LiveSessionId | null;
  // Durable stage (stg_ typeid) this run is performed on — from the WS
  // ticket. Null for anon and for legacy clients (conn-keyed). Stamped onto
  // the recording set so /studio can group sets by stage.
  stageId?: string | null;
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
const rollSeed = (): number => Math.floor(Math.random() * SEED_MAX);

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

// Intensity 0..1 → periodic + pause timing.
//
// Phase 3 raised the periodic floor from 3-7s to 8-16s. The per-frame audio
// reactivity already lives in the client shader (uBass/uMids/uTreble drive
// displacement, bloom, hue every render frame), so slowing the cadence saves
// FAL credits without making the visual feel less alive. pauseMs unchanged —
// the user still wants snappy feedback after a deliberate edit.
const cadenceFromIntensity = (
  i: number
): {
  periodicMs: number;
  pauseMs: number;
} => {
  const I = Math.max(0, Math.min(1, i));
  return {
    pauseMs: Math.round(lerp(1500, 400, I)),
    periodicMs: libraryCadenceMs(I),
  };
};

export class Session implements ControllableSession {
  readonly id: string;
  readonly userId: string | null;
  private scene: SonaraSceneState;
  private lastGeneratedScene: SonaraSceneState;
  private activeJob?: AbortController;
  // Wall-clock start of the in-flight job; 0 when none is running. Drives
  // the periodic no-cannibalize guard in trigger().
  private activeJobStartedAt = 0;
  private activeVersion = 0;
  private pauseTimer?: ReturnType<typeof setTimeout>;
  private periodicTimer?: ReturnType<typeof setInterval>;
  private lastKeyframeAt = 0;
  private readonly publisher = new EventPublisher<{ event: ServerEvent }>();
  private readonly logger: Logger;

  // Mirror of the last frame.final URL and job.status the session emitted.
  // Tracked here (the single send() chokepoint) so the operator remote can
  // read them via getControlSnapshot() without subscribing to the stream.
  private lastFrameUrl: string | null = null;
  private lastJobStatus: ControlSnapshot["jobStatus"] = "idle";

  // The frame the producer's projector reports as on-screen (frame.report),
  // covering the modes the server never generates in (decks, reel replay) as
  // well as live. May be an origin-relative /library/… path for deck frames.
  private currentFrameUrl: string | null = null;

  // What the projector reports it is showing (source.report) — live, a deck,
  // a set replay, or idle. Same producer-truth contract as currentFrameUrl.
  private currentSource: SessionSource | null = null;

  private send(event: ServerEvent): void {
    if (event.type === "frame.final") {
      this.lastFrameUrl = event.imageUrl;
    } else if (event.type === "job.status") {
      this.lastJobStatus = event.status;
    } else if (event.type === "generation.completed") {
      // Every generation path (text realtime/queue, anchor success/failure)
      // emits this at the end — the single chokepoint that marks "no job in
      // flight" for the periodic no-cannibalize guard in trigger().
      this.activeJobStartedAt = 0;
    }
    this.publisher.publish("event", event);
  }

  subscribe(signal?: AbortSignal): AsyncGenerator<ServerEvent> {
    return this.publisher.subscribe("event", signal ? { signal } : undefined);
  }

  private seed: number = rollSeed();

  // Text-mode image model + render resolution, A/B-switchable from the studio
  // (setModel / setResolution). The model key selects the fal endpoint AND the
  // transport (realtime websocket vs queue) via TEXT_MODELS. Per-session, in
  // memory; the client re-sends its choice on every (re)connect, so a fresh
  // Session adopts it. Realtime models stream through `realtimePool`.
  private model: TextModelKey = DEFAULT_TEXT_MODEL;
  private resolution: RenderResolution = DEFAULT_RESOLUTION;
  // Warm per-session websocket pool for realtime models. Lazily dials on first
  // use; closed in close(). No-op cost if the session only ever uses the queue
  // (klein) model. Assigned in the constructor (needs this.logger, which is set
  // there) — a field initializer would run before this.logger exists.
  private readonly realtimePool: RealtimeImagePool;

  private lastSectionEnergy = 0;
  private sectionDeltaStartedAt: number | null = null;
  private lastSectionTriggerAt = 0;
  private lastAudioAt = 0;
  private lastValence = 0.5;
  private lastArousal = 0;
  private lastBpm = 0;
  // Last seen audio rms. Snapshotted into inspector_context at trigger
  // time so /studio can show audio mood when the frame landed.
  private lastRms = 0;
  private silentSinceAt: number | null = null;
  private recognitionInFlight: AbortController | null = null;

  private sessionStartAt = Date.now();
  private lastCreditDenialAt = 0;

  // Stable identifier for this live session — one logical performance
  // segment ("a set"). Legacy clients own it (sessionStorage) and re-send it
  // on every (re)connect; stage-keyed clients get a server mint, learn it via
  // the `run.started` event, and resume it through the registry's grace
  // window. Mutable only through startNewRun() ("new set" — same Session,
  // same publisher, fresh segment). reset() keeps it. Distinct from opts.id
  // (the ephemeral per-tab WS-connection id).
  liveSessionId: LiveSessionId;

  // Durable stage this run plays on (stg_ typeid; null = anon/legacy). Lets
  // the stage subsystem and lens resolve session → stage without a registry
  // scan, and stamps recording sets with their stage.
  readonly stageId: string | null;

  // Whether a screen (producer WS) is currently attached. The registry flips
  // this on detach/resume; while false the periodic tick must not fire —
  // otherwise a graced run keeps burning paid fal generations with nobody
  // watching for up to the whole grace window.
  private attached = true;

  // The authoritative playback source (demoMode/demoDeck successor): what
  // this session should be showing. Frame-driving for deck/set sources is
  // client-side; the server tracks this for the connect snapshot, anon
  // pinning, and the trigger() generation gate. Mutated by control commands
  // (optimistic) and adopted from producer source.report confirmations.
  private source: SessionSourceState = { kind: "idle" };

  // Consecutive image-anchor generation failures. Resets on any anchor
  // success; once it hits ANCHOR_FAILURE_LIMIT we auto-clear the anchor so a
  // dead fal.storage URL (or repeated rejections) stops re-triggering on
  // every periodic tick.
  private anchorFailureCount = 0;
  private static readonly ANCHOR_FAILURE_LIMIT = 3;
  // How long an in-flight generation may run before a periodic tick is
  // allowed to abort-and-replace it (guards against hung fal jobs without
  // letting the cadence starve slow models).
  private static readonly JOB_SUPERSEDE_MS = 60_000;

  // One-shot handoff anchor. Set by goLive() when the user leaves a deck: the
  // first live frame anchors off the deck frame on screen for visual
  // continuity ("take it from there"), then triggerAnchor() clears it so
  // subsequent frames take the cheap text path. Distinct from a user-uploaded
  // anchor, which persists.
  private handoffAnchor = false;

  // The deck the session most recently left when going live. Kept so live
  // generation keeps nudging toward that deck's style (see deckStyle drift in
  // trigger()/triggerAnchor()). Cleared on reset().
  private lastDeck: DeckKey | null = null;

  // Stateful per-keyframe drift sequence. Reseeded whenever the resolver
  // returns fresh LLM-generated drift_candidates (i.e., scene-hash changed).
  // Falls back to the curated static pool until the first LLM cache fill.
  private readonly driftTrajectory = new DriftTrajectory();

  constructor(opts: SessionOpts) {
    this.id = opts.id;
    this.userId = opts.userId;
    this.liveSessionId = opts.liveSessionId ?? typeIdGenerator("liveSession");
    this.stageId = opts.stageId ?? null;
    this.logger = opts.logger.child({
      anon: opts.userId === null,
      sessionId: opts.id,
      userId: opts.userId,
    });
    this.realtimePool = new RealtimeImagePool(this.logger);
    this.scene = { ...defaultScene };
    this.lastGeneratedScene = { ...defaultScene };
    // Anonymous sessions are pinned to deck playback; the connect snapshot
    // relays the source to the client, whose playback loop drives the frames
    // locally. A random deck is suggested; the picker swaps it. Listed decks
    // only — unlisted (show-specific) decks never land on strangers.
    if (opts.userId === null) {
      const deck =
        LISTED_DECK_KEYS[Math.floor(Math.random() * LISTED_DECK_KEYS.length)];
      if (deck) {
        this.source = { deck, kind: "deck" };
      }
    }
    this.startPeriodic();
  }

  init(): void {
    this.send({ state: this.scene, type: "scene.state" });
    this.send({ status: "idle", type: "job.status" });
    // The client never mints run identity — it learns the current segment
    // here (and again from startNewRun). Idempotent on reconnect/resume.
    this.send({ liveSessionId: this.liveSessionId, type: "run.started" });
    // A projector reconnecting while its crowd stage is open must relearn the
    // room code (stage bindings outlive WS connections).
    const stage = this.stageId
      ? stageRooms.statusForStage(this.stageId)
      : stageRooms.statusFor(this.liveSessionId);
    if (stage) {
      this.notifyStage(stage.room, stage.allowPrompts, stage.showQr);
    }
  }

  // Registry hook: producer WS attached/detached. Gates the periodic
  // auto-trigger so a graced (screenless) run never generates.
  setAttached(attached: boolean): void {
    this.attached = attached;
  }

  isAttached(): boolean {
    return this.attached;
  }

  // Takeover signal — rides the shared publisher so both the kicked and the
  // new screen receive it; clients compare connectionId with their own.
  notifyTakenOver(connectionId: string): void {
    this.send({ connectionId, type: "screen.takenOver" });
  }

  // Remote source switch relay (control.setSource). The screen applies it
  // exactly like a local pick and confirms via source.report.
  notifySource(source: {
    deck?: string;
    kind: "set" | "deck" | "idle";
    label?: string | null;
    setId?: string;
  }): void {
    this.send({ source, type: "source.set" });
  }

  // "New set": close out the current recording segment and start the next
  // one in place. Same Session object (the long-lived events iterator stays
  // subscribed to this publisher), same scene — only the run identity and
  // the timing origin change. The previous set finalizes fire-and-forget.
  startNewRun(): LiveSessionId {
    const previous = this.liveSessionId;
    this.activeJob?.abort();
    if (this.userId !== null) {
      void (async () => {
        try {
          await finalizeRecordingSet(getPool(), previous);
        } catch (error) {
          this.logger.warn(
            { error, liveSessionId: previous },
            "recording-set finalize failed on new run"
          );
        }
      })();
    }
    this.liveSessionId = typeIdGenerator("liveSession");
    this.sessionStartAt = Date.now();
    this.lastKeyframeAt = 0;
    this.send({ liveSessionId: this.liveSessionId, type: "run.started" });
    this.logger.info(
      { from: previous, to: this.liveSessionId },
      "new run started"
    );
    return this.liveSessionId;
  }

  // `stage.status` push — the control router calls this when the owner opens
  // or closes the Monad crowd stage (or toggles the join QR), so the projector
  // can mount/unmount its wire overlay + QR and dial the public /ws/stage feed.
  notifyStage(room: string | null, allowPrompts?: boolean, showQr?: boolean): void {
    this.send({ allowPrompts, room, showQr, type: "stage.status" });
  }

  // Idempotent snapshot of server-authoritative state for the client's
  // bootstrap pull (see session.router state procedure). Kept tiny on
  // purpose — the rest flows through the events stream.
  getSnapshot(): SonaraSceneState {
    return this.scene;
  }

  // Source accessor exposed for the bootstrap snapshot. Anon sessions are
  // constructor-pinned to a random deck source, and the client has no other
  // way to learn that — so the snapshot carries it.
  getSource(): SessionSourceState {
    return this.source;
  }

  getImageAnchor(): ImageAnchor | null {
    return this.scene.imageAnchor ?? null;
  }

  // Read-only window for the operator remote (apps/web /control), pulled over
  // HTTP by the authed `control` router. The Display still owns the WS event
  // stream; this lets a second device show the current prompt / thumbnail /
  // status while it drives the same session. See SessionRegistry.
  getControlSnapshot(): ControlSnapshot {
    return {
      currentFrameUrl: this.currentFrameUrl ?? this.lastFrameUrl,
      currentSource: this.currentSource,
      // Deprecated derived shims — see ControlSnapshot.
      demoDeck: this.source.kind === "deck" ? this.source.deck : null,
      demoMode: this.source.kind === "deck",
      imageAnchor: this.scene.imageAnchor ?? null,
      jobStatus: this.lastJobStatus,
      lastFrameUrl: this.lastFrameUrl,
      liveSessionId: this.liveSessionId,
      nowPlaying: this.scene.nowPlaying ?? null,
      scene: this.scene,
      source: this.source,
      startedAt: this.sessionStartAt,
    };
  }

  // Producer-reported on-screen frame (WS frame.report). The projector is the
  // only client that sends this — once per keyframe change (every 2–6s), in
  // every mode. Not validated as a URL: deck frames are origin-relative paths.
  setCurrentFrame(url: string): void {
    this.currentFrameUrl = url;
  }

  // Producer-reported source (WS source.report) — sent once per transport
  // switch, same producer-only contract as setCurrentFrame.
  setCurrentSource(source: SessionSource): void {
    this.currentSource = source;
    // Adopt producer truth into the authoritative source so a screen-local
    // pick (deck chip on /play) and a control command converge on the same
    // state. Guards: anon stays pinned to playback kinds; deck reports from
    // stale clients may lack the key — leave intent alone then; set reports
    // need a setId.
    if (
      (source.kind === "live" || source.kind === "idle") &&
      this.userId !== null
    ) {
      this.source = { kind: source.kind };
    } else if (source.kind === "deck" && source.deck) {
      this.source = { deck: source.deck, kind: "deck" };
    } else if (source.kind === "set" && source.setId) {
      this.source = {
        kind: "set",
        label: source.label ?? null,
        setId: source.setId,
      };
    }
  }

  // Set or clear the live session's image anchor. Setting clears demoMode
  // (anchor and demo are mutually exclusive — anchor wins). Fires a trigger
  // immediately so the first anchor frame lands without waiting for the
  // semantic-diff gate.
  setImageAnchor(
    input: { url: string; strength: number } | { clear: true }
  ): void {
    if ("clear" in input) {
      if (!this.scene.imageAnchor) {
        return;
      }
      this.scene = { ...this.scene, imageAnchor: undefined };
      this.send({ state: this.scene, type: "scene.state" });
      this.logger.info({}, "image anchor cleared");
      return;
    }
    // No-op dedupe: re-pinning the exact same {url, strength} (reconnect
    // re-hydration, or re-clicking the already-active preset) must not fire a
    // fresh paid generation. A *different* strength still falls through.
    const cur = this.scene.imageAnchor;
    if (cur && cur.url === input.url && cur.strength === input.strength) {
      return;
    }
    // Anchor wins over playback. setSource doesn't touch anchor; if both are
    // attempted to be set simultaneously, the most recent mutation lands.
    // Uploading an anchor from a deck is also "going live" — remember the deck
    // so its style keeps nudging generation (deckStyle drift).
    if (this.source.kind === "deck") {
      this.lastDeck = this.source.deck;
    }
    this.source = { kind: "live" };
    // Fresh anchor → reset the failure streak from any prior anchor.
    this.anchorFailureCount = 0;
    this.scene = {
      ...this.scene,
      imageAnchor: { strength: input.strength, url: input.url },
    };
    this.send({ state: this.scene, type: "scene.state" });
    this.logger.info(
      { strength: input.strength, url: input.url },
      "image anchor set"
    );
    // Fire trigger immediately — bypasses semantic-diff gate so the first
    // anchor frame lands without waiting.
    void this.trigger("semantic");
  }

  // A/B-switch the text-mode image model. The key selects the fal endpoint +
  // transport (realtime vs queue) via TEXT_MODELS. Fires a frame immediately
  // (skips the semantic-diff gate) so the switch is visible at once; trigger()
  // no-ops for demo/anon/empty-prompt sessions. Skipped when an image anchor
  // is active — the model setting is text-path only.
  setModel(model: TextModelKey): void {
    if (this.model === model) {
      return;
    }
    this.model = model;
    this.logger.info({ model }, "text model set");
    if (!this.scene.imageAnchor) {
      void this.trigger("semantic");
    }
  }

  // A/B-switch the render resolution (512² / 768²). Lower = faster + smaller
  // payload. Same immediate-frame + anchor-skip semantics as setModel.
  setResolution(resolution: RenderResolution): void {
    if (this.resolution === resolution) {
      return;
    }
    this.resolution = resolution;
    this.logger.info({ resolution }, "render resolution set");
    if (!this.scene.imageAnchor) {
      void this.trigger("semantic");
    }
  }

  // Transition from deck/library phase to live generation. The browser flips
  // its own demoMode (stopping the client demo loop) and calls this so the
  // server mirrors the flag, applies the typed scene, and — for visual
  // continuity — seeds the FIRST live frame off the deck frame currently on
  // screen as a one-shot anchor (8 cr). triggerAnchor() clears that anchor
  // after the frame lands, so everything after is the cheap text path (1 cr).
  goLive(prompt: string, seedFrameUrl: string | null): void {
    // Live generation needs credits. Anon is refused here (the client also
    // gates by never showing the prompt input to anon).
    if (this.userId === null) {
      this.logger.info({}, "anon goLive refused");
      this.send({
        message: "Sign in to bring your own scenes",
        status: "error",
        type: "job.status",
      });
      return;
    }
    if (this.source.kind === "deck") {
      this.lastDeck = this.source.deck;
    }
    this.source = { kind: "live" };
    this.scene = { ...this.scene, prompt: clampPrompt(prompt) };
    if (seedFrameUrl) {
      this.handoffAnchor = true;
      this.anchorFailureCount = 0;
      this.scene = {
        ...this.scene,
        imageAnchor: { strength: 0.55, url: seedFrameUrl },
      };
    }
    this.send({ state: this.scene, type: "scene.state" });
    this.logger.info(
      { lastDeck: this.lastDeck, prompt, seedFrameUrl },
      "go live"
    );
    // Fire immediately — bypasses the semantic-diff gate so the handoff frame
    // (or first text frame) lands without waiting.
    void this.trigger("semantic");
  }

  applyPatch(
    patch: ClientScenePatch,
    origin: "client" | "voice" = "client"
  ): void {
    // Cap the prompt server-side (defense in depth — the input also caps it).
    const safePatch =
      typeof patch.prompt === "string"
        ? { ...patch, prompt: clampPrompt(patch.prompt) }
        : patch;
    const next: SonaraSceneState = { ...this.scene, ...safePatch };
    this.scene = next;
    this.send({ state: next, type: "scene.state" });

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
    this.lastRms = features.rms;

    // Silence-clear for nowPlaying. Kept independent of section detection
    // because sectionEnergy is EMA-smoothed and lags actual silence.
    if (features.rms < RMS_SILENT) {
      if (this.silentSinceAt === null) {
        this.silentSinceAt = now;
      }
      if (
        this.scene.nowPlaying &&
        now - this.silentSinceAt > NOW_PLAYING_SILENCE_CLEAR_MS
      ) {
        this.logger.info(
          { title: this.scene.nowPlaying.title },
          "silence sustained — clearing nowPlaying"
        );
        this.scene = { ...this.scene, nowPlaying: undefined };
        this.send({ state: this.scene, type: "scene.state" });
        this.send({
          source: "audd",
          track: null,
          trigger: "auto",
          type: "now.playing",
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
    trigger: "auto" | "manual"
  ): Promise<NowPlaying | null> {
    // Anonymous sessions never call AudD or the LLM muse — both have
    // per-call cost and the demo loop doesn't need song titles. The UI
    // hides the now-playing trigger for anon already; this is defence in
    // depth in case a stale client posts here anyway.
    if (this.userId === null) {
      return null;
    }
    // Auto-trigger dedupe: if we already know a song, don't burn an AudD
    // call. Manual always goes through so the user can force a refresh.
    if (trigger === "auto" && this.scene.nowPlaying) {
      this.logger.debug(
        { title: this.scene.nowPlaying.title },
        "recognize: nowPlaying already set, skipping auto"
      );
      return this.scene.nowPlaying;
    }
    this.recognitionInFlight?.abort();
    const controller = new AbortController();
    this.recognitionInFlight = controller;

    let outcome: Awaited<ReturnType<typeof recognizeClip>>;
    try {
      outcome = await recognizeClip(clipBase64, mimeType, this.logger);
    } catch (error) {
      this.logger.warn({ error }, "recognize: threw");
      return null;
    } finally {
      if (this.recognitionInFlight === controller) {
        this.recognitionInFlight = null;
      }
    }

    if (controller.signal.aborted) {
      return null;
    }

    const { track, source } = outcome;

    this.logger.info(
      {
        artist: track?.artist,
        matched: Boolean(track),
        source,
        title: track?.title,
        trigger,
      },
      "recognize: result"
    );

    this.send({ source, track, trigger, type: "now.playing" });

    if (!track) {
      return null;
    }

    // Pin nowPlaying to the scene so the HUD can show it. Track metadata no
    // longer auto-fills scene fields deterministically — the LLM muse below
    // synthesises a single evocative prompt that abstracts the song, and
    // overwrites scene.prompt only when the user hasn't authored their own.
    this.scene = { ...this.scene, nowPlaying: track };
    this.send({ state: this.scene, type: "scene.state" });

    // LLM muse — translate the track into an evocative visual prompt sentence.
    // Awaited so we fire a single trigger with the synthesised prompt instead
    // of triggering twice. ~1-2s on gemini-2.5-flash-lite; user is already
    // waiting on the identify click. Failures fall through to `track.title`
    // as a last-resort prompt.
    let muse: SongMusePatch | null = null;
    try {
      muse = await synthesizeFromTrack(
        {
          arousal: this.lastArousal,
          bpm: this.lastBpm,
          track,
          valence: this.lastValence,
        },
        { logger: this.logger, signal: controller.signal }
      );
    } catch (error) {
      this.logger.warn({ error }, "song-muse: unhandled");
    }
    if (controller.signal.aborted) {
      return null;
    }

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
      this.send({ state: this.scene, type: "scene.state" });
      this.logger.info(
        { hasLlmSynth: muse !== null, prompt: nextPrompt },
        "song-muse: scene enriched"
      );
    }

    // Fire a regeneration so the new prompt lands immediately. "section" is
    // the closest semantic match ("the song changed").
    this.trigger("section");
    return track;
  }

  setSource(source: SessionSourceState): void {
    // Anonymous sessions can switch decks/sets but cannot leave client-driven
    // playback. Letting them go live would push trigger() into the fal path,
    // where the userId-null guard would refuse to generate — the visualiser
    // would just stop; idle would blank it. Pin them to playback kinds.
    if (
      this.userId === null &&
      (source.kind === "live" || source.kind === "idle")
    ) {
      this.logger.info(
        { kind: source.kind },
        "anon setSource ignored — pinned to playback"
      );
      return;
    }
    this.source = source;
    this.logger.info({ source }, "source set");
    // Deck/set frames are driven client-side; the client starts/stops its
    // own playback loop on the relayed source.set, so nothing to trigger.
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
    this.currentFrameUrl = null;
    this.currentSource = null;
    this.seed = rollSeed();
    this.sessionStartAt = Date.now();
    this.silentSinceAt = null;
    this.handoffAnchor = false;
    this.lastDeck = null;
    this.recognitionInFlight?.abort();
    this.recognitionInFlight = null;
    this.startPeriodic();
    this.send({ state: this.scene, type: "scene.state" });
    this.send({
      source: "audd",
      track: null,
      trigger: "auto",
      type: "now.playing",
    });
    this.send({ status: "idle", type: "job.status" });
  }

  close(): void {
    this.activeJob?.abort();
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
    }
    if (this.periodicTimer) {
      clearInterval(this.periodicTimer);
    }
    // Tear down the warm realtime websocket(s) — nothing else closes them.
    this.realtimePool.close();
  }

  private schedulePause(): void {
    if (this.pauseTimer) {
      clearTimeout(this.pauseTimer);
    }
    const { pauseMs } = cadenceFromIntensity(this.scene.intensity);
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = undefined;
      const diff = semanticDiff(this.lastGeneratedScene, this.scene);
      if (diff > 0.05) {
        this.trigger("pause");
      }
    }, pauseMs);
  }

  private startPeriodic(): void {
    this.periodicTimer = setInterval(() => {
      const now = Date.now();
      const { periodicMs } = cadenceFromIntensity(this.scene.intensity);
      if (now - this.lastKeyframeAt < periodicMs) {
        return;
      }
      // Deck/set playback is client-driven; the server only auto-triggers
      // LIVE generation, never while a playback source is showing.
      if (this.source.kind === "deck" || this.source.kind === "set") {
        return;
      }
      // No screen attached (reconnect grace window) → nobody is watching;
      // never burn paid generations into the void.
      if (!this.attached) {
        return;
      }
      const hasAudio = now - this.lastAudioAt < 5000;
      const hasScene = this.scene.prompt.trim().length > 0;
      if (!hasAudio && !hasScene) {
        return;
      }
      this.trigger("periodic");
    }, 1000);
  }

  // Append a just-persisted frame to this performance's recording set
  // (frame_set origin 'recording' — see library/recording-set.ts). Fire-and-
  // forget: recording must never break or slow generation; failures log and
  // skip. The ensure upsert is cheap and reconnect-safe, so it runs per frame.
  private recordFrame(frameId: ImageLibraryId, tMs: number): void {
    const { userId } = this;
    // Anonymous sessions never persist (library-only mode); defence in depth.
    if (userId === null) {
      return;
    }
    void (async () => {
      try {
        const pool = getPool();
        await ensureRecordingSet(pool, {
          liveSessionId: this.liveSessionId,
          stageUuid: this.stageId
            ? typeIdToUuid(this.stageId as StageId).uuid
            : null,
          startedAt: new Date(this.sessionStartAt),
          userUuid: userId,
        });
        await appendRecordingFrame(pool, {
          frameUuid: typeIdToUuid(frameId).uuid,
          liveSessionId: this.liveSessionId,
          tMs,
        });
      } catch (error) {
        this.logger.warn({ error, frameId }, "recording-set append failed");
      }
    })();
  }

  // A periodic tick must NOT cannibalize a still-running generation. Slow
  // models (the anchor's flux-pro ultra on a congested fal queue) can take
  // longer than the periodic cadence — if every tick aborted the in-flight
  // job and restarted the queue wait, nothing would ever complete: frames
  // starve forever while credits churn through debit/refund. Let the running
  // job land; supersede it only when it's clearly hung (JOB_SUPERSEDE_MS).
  // User edits (semantic/pause/voice) still abort-and-replace immediately.
  private jobStillRunning(): boolean {
    return (
      this.activeJob !== undefined &&
      !this.activeJob.signal.aborted &&
      this.activeJobStartedAt > 0 &&
      Date.now() - this.activeJobStartedAt < Session.JOB_SUPERSEDE_MS
    );
  }

  private async trigger(source: TriggerSource): Promise<void> {
    const kind = kindFromSource(source);
    // Keep `reason` for log + event compatibility — it goes on the wire as
    // part of `job.status` / `generation.requested`.
    const reason = source;

    // Deck/set playback is fully client-driven (the browser cycles static
    // per-deck manifests or fetched set frames, so playback works on slow/no
    // internet and the server never generates during it). This path runs
    // only for live generation. Idle + the empty-prompt guard below keep
    // idle sessions from generating, while a typed prompt still flows.
    if (this.source.kind === "deck" || this.source.kind === "set") {
      return;
    }

    if (reason === "periodic" && this.jobStillRunning()) {
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

    // Defence in depth. The constructor pins anon sessions to a deck source,
    // so the short-circuit above always catches them. If that invariant ever
    // breaks (someone flips the source programmatically), we refuse to enter
    // the paid path rather than billing a phantom user.
    if (this.userId === null) {
      this.logger.warn({ reason }, "anon trigger reached fal path — bailing");
      return;
    }
    const { userId } = this;

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
      isUserInitiated: kind === "user",
      lastCreditDenialAt: this.lastCreditDenialAt,
      logger: this.logger,
      now: Date.now(),
      userId,
    });
    this.lastCreditDenialAt = gate.nextLastDenialAt;

    if (!gate.ok) {
      this.logger.info({ gateReason: gate.reason, reason }, "trigger denied");
      if (gate.shouldEmit) {
        this.send({
          message:
            gate.reason === "system_error"
              ? "Payment system unavailable"
              : "Out of credits — top up to keep generating",
          reason,
          status: "error",
          type: "job.status",
        });
      }
      return;
    }

    const { paidCost } = gate;

    // Drift modifier. Trajectory is LLM-seeded when scene-llm-expander has
    // filled drift_candidates; otherwise it walks the curated static pool.
    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS
    );
    const drift = this.driftTrajectory.next();
    const driftSource: "pool" | "none" = drift ? "pool" : "none";

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;
    this.activeJobStartedAt = Date.now();

    this.activeVersion += 1;
    const version = this.activeVersion;
    // Every keyframe is a fresh text-to-image generation. No reference
    // image, no identity lock — prompt changes take effect on the very
    // next frame.
    this.scene = { ...this.scene, version };
    const snapshot: SonaraSceneState = this.scene;

    this.send({ state: this.scene, type: "scene.state" });

    // Resolve the flat scene into the structured ResolvedScene, then serialise
    // to the FLUX prompt. Single source of truth: the inspector HUD's
    // `promptString` and `resolvedScene` both come from this one build.
    //
    // For USER-initiated triggers (voice / semantic / pause) we await the LLM
    // expansion so the first frame after a prompt edit gets the rich
    // expanded resolved scene instead of the bland deterministic fallback.
    // ~1-2s extra latency vs the parallel-fire path; subjective quality jump
    // is large. Auto-triggers (periodic / section) keep the sync path so
    // they never block.
    const resolveOpts = {
      audio: {
        energyDelta: 0,
        intensity: this.scene.intensity,
        section: this.lastSectionEnergy,
      },
      // Drift = pool/LLM walk + (when we came from a deck) that deck's style,
      // so live frames stay on-vibe with the deck the user left.
      driftModifiers: [
        drift,
        this.lastDeck ? deckStyle(this.lastDeck) : null,
      ].filter((m): m is string => !!m),
      logger: this.logger,
      signal: controller.signal,
    };
    const resolved =
      kind === "user"
        ? await resolveSceneAwaited(this.scene, resolveOpts)
        : resolveScene(this.scene, resolveOpts);
    if (controller.signal.aborted) {
      return;
    }
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
          "drift trajectory reseeded"
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
        "trigger skipped: empty resolved prompt"
      );
      return;
    }

    this.logger.info(
      {
        drift,
        driftSource,
        prompt,
        reason,
        seed: this.seed,
        sessionProgress: Number(sessionProgress.toFixed(2)),
        version,
      },
      "trigger fire"
    );
    this.send({ reason, status: "running", type: "job.status" });

    const requestedAt = Date.now();
    const { periodicMs } = cadenceFromIntensity(this.scene.intensity);
    this.send({
      driftSource,
      nextKeyframeAt: this.lastKeyframeAt + periodicMs,
      promptString: prompt,
      reason,
      requestedAt,
      resolvedScene: resolved,
      type: "generation.requested",
      version,
    });

    const modelCfg = TEXT_MODELS[this.model];
    const size = { height: this.resolution, width: this.resolution };

    // Transport-agnostic callbacks. The realtime websocket pool and the klein
    // queue path share identical onPreview/onFinal/onError wiring — the version
    // check + refund-on-error semantics don't care which transport delivered
    // (or failed to deliver) the frame.
    const frameCallbacks = {
      logger: this.logger,
      onError: (err: unknown) => {
        // Refund regardless of abort — the provider routes superseded
        // generations through onError too, and the user should get the
        // credit back since no frame was delivered. Free-tier paths set
        // paidCost=null so this is a no-op for them.
        refundOnError(userId, paidCost, this.logger);
        // Aborts are expected (newer trigger superseded this one). Don't
        // log noisily or surface to the client.
        if (controller.signal.aborted) {
          return;
        }
        this.logger.error({ err }, "generation failed");
        const message = err instanceof Error ? err.message : String(err);
        this.send({
          message,
          status: "error",
          type: "job.status",
        });
        this.send({
          durationMs: Date.now() - requestedAt,
          message,
          success: false,
          type: "generation.completed",
          version,
        });
      },
      onFinal: (url: string) => {
        if (version !== this.activeVersion) {
          return;
        }
        // Reset the idle-cadence clock to THIS rendered frame, so the next
        // periodic/ambient frame lands a full interval later. A deliberate
        // prompt edit fires immediately (ungated by cadence), and this keeps it
        // from being followed by a periodic frame stacking right on top.
        this.lastKeyframeAt = Date.now();
        this.lastGeneratedScene = snapshot;
        const tMs = Date.now() - this.sessionStartAt;
        const frameId = typeIdGenerator("imageLibrary");
        this.send({
          frameId,
          imageUrl: url,
          tMs,
          type: "frame.final",
          version,
        });
        this.send({ status: "idle", type: "job.status" });
        this.send({
          durationMs: Date.now() - requestedAt,
          success: true,
          type: "generation.completed",
          version,
        });
        // Fire-and-forget persist. Never blocks the rendering hot path;
        // failures log and skip. Emits library.appended on success so the
        // client's timeline can append the row without polling.
        const persisted = persistFrame({
          deck: this.lastDeck ?? "live",
          falUrl: url,
          height: size.height,
          id: frameId,
          inspectorContext: {
            audio: {
              arousal: this.lastArousal,
              bpm: this.lastBpm,
              rms: this.lastRms,
              sectionEnergy: this.lastSectionEnergy,
              valence: this.lastValence,
            },
            driftModifier: drift ?? undefined,
            nowPlaying: this.scene.nowPlaying,
            resolvedSummary: {
              lighting: resolved.lighting,
              mood: resolved.mood,
              palette: resolved.color_palette,
              subjects: resolved.subjects.map((s) => s.description),
            },
          },
          logger: this.logger,
          model: modelCfg.falId,
          palette: resolved.color_palette,
          prompt,
          seed: this.seed,
          sessionId: this.liveSessionId,
          tMs,
          triggerReason: source,
          userId,
          width: size.width,
        });
        void (async () => {
          try {
            const row = await persisted;
            if (!row) {
              return;
            }
            this.send({ frame: row, type: "library.appended" });
            // Persist succeeded → append to the auto-recorded set.
            this.recordFrame(frameId, tMs);
          } catch (error) {
            // Fire-and-forget: a persist/send failure here must never become an
            // unhandled rejection (on a single-replica in-memory server that can
            // crash Bun and drop every live session). Mirror the streamPreview/
            // streamAnchor .catch guard above.
            this.logger.error({ error }, "persistFrame unhandled");
          }
        })();
      },
      onPreview: (url: string) => {
        if (version !== this.activeVersion) {
          return;
        }
        this.send({ imageUrl: url, type: "frame.preview", version });
      },
      prompt,
      seed: this.seed,
      signal: controller.signal,
    };

    if (modelCfg.transport === "realtime") {
      // Warm websocket — bypasses the queue for the ~150-300ms warm floor.
      // Fire-and-forget: the pool reports via the callbacks above and never
      // throws synchronously past its own guard.
      this.realtimePool.stream({
        ...frameCallbacks,
        falModelId: modelCfg.falId,
        guidanceScale: modelCfg.guidanceScale,
        size,
        steps: modelCfg.steps,
      });
    } else {
      // Queue path (klein/9b quality baseline). Fire-and-forget: streamPreview
      // must stream in the background; awaiting would block trigger() on the
      // live hot path. Its onError/onFinal/onPreview are its callback contract.
      const queued = streamPreview({
        ...frameCallbacks,
        model: modelCfg.falId,
        size,
      });
      // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- REVIEW: see the fire-and-forget note above; the trigger() hot path cannot await.
      queued.catch((error) => {
        if (!controller.signal.aborted) {
          this.logger.error({ error }, "streamPreview unhandled");
        }
      });
    }
  }

  // Image-anchor-mode trigger. Calls fal flux-pro/v1.1-ultra with the user's
  // uploaded image conditioning the output. Emits the same crossfade events
  // as the text-mode path so the client doesn't need to distinguish.
  private async triggerAnchor(source: TriggerSource): Promise<void> {
    const anchor = this.scene.imageAnchor;
    if (!anchor) {
      return;
    }

    // Anon defence in depth — the upload route is authed-only, but if a
    // null userId somehow reached this path we refuse to bill phantom.
    if (this.userId === null) {
      this.logger.warn(
        { source },
        "anon trigger reached anchor path — bailing"
      );
      return;
    }
    const { userId } = this;
    const kind = kindFromSource(source);
    const reason = source;

    const gate = await tryDebitCredit({
      cost: ANCHOR_FRAME_COST_CREDITS,
      isUserInitiated: kind === "user",
      lastCreditDenialAt: this.lastCreditDenialAt,
      logger: this.logger,
      now: Date.now(),
      userId,
    });
    this.lastCreditDenialAt = gate.nextLastDenialAt;

    if (!gate.ok) {
      this.logger.info(
        { cost: ANCHOR_FRAME_COST_CREDITS, gateReason: gate.reason, reason },
        "anchor trigger denied"
      );
      if (gate.shouldEmit) {
        this.send({
          message:
            gate.reason === "system_error"
              ? "Payment system unavailable"
              : "Out of credits — top up to keep generating",
          reason,
          status: "error",
          type: "job.status",
        });
      }
      return;
    }
    const { paidCost } = gate;

    const sessionProgress = Math.min(
      1,
      (Date.now() - this.sessionStartAt) / SESSION_ARC_MS
    );
    const drift = this.driftTrajectory.next();
    const driftSource: "pool" | "none" = drift ? "pool" : "none";

    this.activeJob?.abort();
    const controller = new AbortController();
    this.activeJob = controller;
    this.activeJobStartedAt = Date.now();

    this.activeVersion += 1;
    const version = this.activeVersion;
    this.scene = { ...this.scene, version };
    const snapshot: SonaraSceneState = this.scene;

    this.send({ state: this.scene, type: "scene.state" });

    // Resolve the prompt through the same LLM expander as text-mode so the
    // inspector HUD shows coherent metadata and so the drift trajectory
    // gets seeded on first call. User-initiated triggers await the LLM
    // expansion (richer first frame after a prompt edit); auto-triggers
    // stay on the sync deterministic-then-cache path.
    const resolveOpts = {
      audio: {
        energyDelta: 0,
        intensity: this.scene.intensity,
        section: this.lastSectionEnergy,
      },
      // Drift = pool/LLM walk + (when we came from a deck) that deck's style,
      // so live frames stay on-vibe with the deck the user left.
      driftModifiers: [
        drift,
        this.lastDeck ? deckStyle(this.lastDeck) : null,
      ].filter((m): m is string => !!m),
      logger: this.logger,
      signal: controller.signal,
    };
    const resolved =
      kind === "user"
        ? await resolveSceneAwaited(this.scene, resolveOpts)
        : resolveScene(this.scene, resolveOpts);
    if (controller.signal.aborted) {
      return;
    }
    if (resolved.drift_candidates.length > 0) {
      this.driftTrajectory.reseed({
        candidates: resolved.drift_candidates,
        sessionProgress,
      });
    }
    const prompt = serializeResolvedScene(resolved);

    this.logger.info(
      {
        anchorStrength: anchor.strength,
        anchorUrl: anchor.url,
        prompt,
        reason,
        seed: this.seed,
        version,
      },
      "anchor trigger fire"
    );
    this.send({ reason, status: "running", type: "job.status" });

    const requestedAt = Date.now();
    const { periodicMs } = cadenceFromIntensity(this.scene.intensity);
    this.send({
      driftSource,
      nextKeyframeAt: this.lastKeyframeAt + periodicMs,
      promptString: prompt,
      reason,
      requestedAt,
      resolvedScene: resolved,
      type: "generation.requested",
      version,
    });

    streamAnchor({
      imageUrl: anchor.url,
      logger: this.logger,
      onError: (err) => {
        refundOnError(userId, paidCost, this.logger);
        // Aborts are expected supersessions (newer trigger won) — they don't
        // count toward the failure streak.
        if (controller.signal.aborted) {
          return;
        }
        // One-shot deck→live handoff anchor that failed (e.g. a seed URL fal
        // can't fetch — local dev serves /library from localhost). Don't retry
        // it: clear it so the next periodic tick generates from text. Doesn't
        // count toward the user-anchor failure streak.
        if (this.handoffAnchor) {
          this.handoffAnchor = false;
          this.scene = { ...this.scene, imageAnchor: undefined };
          this.send({ state: this.scene, type: "scene.state" });
          this.logger.info(
            { err: err instanceof Error ? err.message : String(err) },
            "handoff anchor failed — cleared, continuing text-only"
          );
          this.send({
            durationMs: Date.now() - requestedAt,
            success: false,
            type: "generation.completed",
            version,
          });
          return;
        }
        this.anchorFailureCount += 1;
        this.logger.error(
          { anchorFailureCount: this.anchorFailureCount, err },
          "anchor generation failed"
        );
        const message = err instanceof Error ? err.message : String(err);
        if (this.anchorFailureCount >= Session.ANCHOR_FAILURE_LIMIT) {
          // Dead fal.storage URL or repeated rejections — auto-clear the
          // anchor so we stop retrying (and refunding) it on every periodic
          // tick. The user can re-upload to try again.
          this.anchorFailureCount = 0;
          this.scene = { ...this.scene, imageAnchor: undefined };
          this.send({ state: this.scene, type: "scene.state" });
          this.send({
            message:
              "Image anchor failed repeatedly — cleared it. Re-upload to try again.",
            status: "error",
            type: "job.status",
          });
        } else {
          this.send({ message, status: "error", type: "job.status" });
        }
        this.send({
          durationMs: Date.now() - requestedAt,
          message,
          success: false,
          type: "generation.completed",
          version,
        });
      },
      onFinal: (url) => {
        if (version !== this.activeVersion) {
          return;
        }
        // success clears the failure streak
        this.anchorFailureCount = 0;
        // One-shot deck→live handoff anchor: clear it now that the continuity
        // frame has landed, so the NEXT trigger uses the cheap text path
        // instead of re-billing 8 cr on every periodic tick.
        if (this.handoffAnchor) {
          this.handoffAnchor = false;
          this.scene = { ...this.scene, imageAnchor: undefined };
          this.send({ state: this.scene, type: "scene.state" });
        }
        this.lastGeneratedScene = snapshot;
        const tMs = Date.now() - this.sessionStartAt;
        const frameId = typeIdGenerator("imageLibrary");
        this.send({
          frameId,
          imageUrl: url,
          tMs,
          type: "frame.final",
          version,
        });
        this.send({ status: "idle", type: "job.status" });
        this.send({
          durationMs: Date.now() - requestedAt,
          success: true,
          type: "generation.completed",
          version,
        });
        // Fire-and-forget persist for the generated frame. Note: the
        // anchor INPUT image (user upload at fal.storage) is NOT
        // persisted — only the generated output gets a library row.
        const persisted = persistFrame({
          anchorUrl: anchor.url,
          deck: this.lastDeck ?? "live",
          falUrl: url,
          height: 1024,
          id: frameId,
          inspectorContext: {
            audio: {
              arousal: this.lastArousal,
              bpm: this.lastBpm,
              rms: this.lastRms,
              sectionEnergy: this.lastSectionEnergy,
              valence: this.lastValence,
            },
            driftModifier: drift ?? undefined,
            nowPlaying: this.scene.nowPlaying,
            resolvedSummary: {
              lighting: resolved.lighting,
              mood: resolved.mood,
              palette: resolved.color_palette,
              subjects: resolved.subjects.map((s) => s.description),
            },
          },
          logger: this.logger,
          model: env.FAL_ANCHOR_MODEL,
          palette: resolved.color_palette,
          prompt,
          seed: this.seed,
          sessionId: this.liveSessionId,
          tMs,
          triggerReason: source,
          userId,
          // flux-pro/v1.1-ultra at aspect_ratio: "1:1" returns 1024².
          width: 1024,
        });
        void (async () => {
          try {
            const row = await persisted;
            if (!row) {
              return;
            }
            this.send({ frame: row, type: "library.appended" });
            // Persist succeeded → append to the auto-recorded set.
            this.recordFrame(frameId, tMs);
          } catch (error) {
            // Fire-and-forget: a persist/send failure here must never become an
            // unhandled rejection (on a single-replica in-memory server that can
            // crash Bun and drop every live session). Mirror the streamPreview/
            // streamAnchor .catch guard above.
            this.logger.error({ error }, "persistFrame unhandled");
          }
        })();
      },
      onPreview: (url) => {
        if (version !== this.activeVersion) {
          return;
        }
        this.send({ imageUrl: url, type: "frame.preview", version });
      },
      prompt,
      seed: this.seed,
      signal: controller.signal,
      strength: anchor.strength,
      // oxlint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks -- REVIEW: fire-and-forget: streamAnchor must stream in the background; awaiting would block triggerAnchor() on the live hot path. streamAnchor's onError/onFinal/onPreview are its callback API contract.
    }).catch((error) => {
      if (!controller.signal.aborted) {
        this.logger.error({ error }, "streamAnchor unhandled");
      }
    });
  }
}
