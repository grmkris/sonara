import type {
  ClientScenePatch,
  DeckKey,
  ImageAnchor,
  NowPlaying,
  SonaraSceneState,
} from "@sonara/shared";
import type { LiveSessionId } from "@sonara/shared/typeid";

// Mirrors the `job.status` event's status union. Tracked on the live Session
// so the operator remote can poll it without subscribing to the event stream.
export type JobStatus = "idle" | "running" | "cancelled" | "error";

// What the producer's projector says it is showing right now — live
// generation, a builtin deck, a set replay, or nothing. Reported over WS
// (source.report) on every source change, same producer-truth rationale as
// frame.report / currentFrameUrl.
export interface SessionSource {
  deck?: DeckKey;
  kind: "live" | "deck" | "set" | "idle";
  label: string | null;
  setId?: string;
}

// The server's authoritative playback-source state — the demoMode/demoDeck
// successor. Mutated by control commands (optimistically) and adopted from
// producer reports; trigger() refuses fal generation while a client-driven
// source (deck/set) is showing.
export type SessionSourceState =
  | { kind: "live" }
  | { kind: "idle" }
  | { kind: "deck"; deck: DeckKey }
  | { kind: "set"; setId: string; label: string | null };

// Server-authoritative snapshot of a live Session, pulled over HTTP by the
// operator remote (apps/web /control) instead of the WebSocket event stream.
// The Display still owns the socket; this is a read-only window for a second
// device that drives the same session.
export interface ControlSnapshot {
  liveSessionId: LiveSessionId;
  scene: SonaraSceneState;
  // Server intent — what the session should be showing. The producer confirm
  // lives in currentSource; keep both (console pills read intent, viewers
  // read producer truth).
  source: SessionSourceState;
  // DEPRECATED shims derived from `source` — kept one release for web code
  // not yet migrated to `source`. Delete with the setDemoMode shims.
  demoMode: boolean;
  demoDeck: DeckKey | null;
  imageAnchor: ImageAnchor | null;
  nowPlaying: NowPlaying | null;
  jobStatus: JobStatus;
  // Last final frame URL the server emitted. Null in demo mode (frames are
  // client-driven there) and before the first live frame lands.
  lastFrameUrl: string | null;
  // The frame actually on the producer's screen right now, reported by the
  // projector over WS (frame.report) in EVERY mode — live, deck, reel. Unlike
  // lastFrameUrl this is never null while something is showing, so viewers and
  // the operator preview should prefer it. May be an origin-relative path
  // (/library/…) for deck frames — only resolvable on the web origin.
  currentFrameUrl: string | null;
  // Producer-reported source (source.report) — null until the first report.
  currentSource: SessionSource | null;
  // Wall-clock ms when the live Session was constructed.
  startedAt: number;
}

// The slice of a live Session an operator can drive remotely over HTTP. The
// concrete Session (apps/server) satisfies this structurally; defining it here
// keeps the api package framework-agnostic (same rationale as SessionLike).
export interface ControllableSession {
  readonly userId: string | null;
  readonly liveSessionId: LiveSessionId;
  // Durable stage (stg_ typeid) this run plays on; null for anon/legacy runs.
  readonly stageId: string | null;
  applyPatch(patch: ClientScenePatch, origin?: "client" | "voice"): void;
  goLive(prompt: string, seedFrameUrl: string | null): void;
  setSource(source: SessionSourceState): void;
  setImageAnchor(
    input: { url: string } | { clear: true }
  ): void;
  setCurrentFrame(url: string): void;
  setCurrentSource(source: SessionSource): void;
  reset(): void;
  getControlSnapshot(): ControlSnapshot;
  // Push a `stage.status` event to this session's projector — emitted by the
  // control router when the owner opens/closes the Monad crowd stage or
  // toggles the projector's join-QR overlay.
  notifyStage(room: string | null, allowPrompts?: boolean, showQr?: boolean): void;
  // "New set": finalize the current recording segment and start the next run
  // in place (same Session, same publisher). Returns the new run id.
  startNewRun(): LiveSessionId;
  // Relay a remote source switch (`source.set` event) to the screen.
  notifySource(source: {
    deck?: string;
    kind: "set" | "deck" | "idle";
    label?: string | null;
    setId?: string;
  }): void;
}

// Lookup surface over the live in-memory sessions. apps/server's
// SessionManager implements this and is threaded into the HTTP context so the
// authed `control` router can find the caller's own live session(s).
export interface SessionRegistry {
  // rawUserId is the raw UUID (matching Session.userId), NOT the typeid.
  listByUserId(rawUserId: string): ControllableSession[];
  getByLiveSessionId(liveSessionId: string): ControllableSession | undefined;
  // Stage-keyed lookups (stage-keyed runs only; legacy conn-keyed runs are
  // reachable via the two methods above).
  getByStageId(stageId: string): ControllableSession | undefined;
  // A graced run still exists (lens reads it live) but has no screen — the
  // console's "no screen connected" copy keys off this.
  screenAttached(stageId: string): boolean;
}
