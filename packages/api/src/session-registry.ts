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

// Server-authoritative snapshot of a live Session, pulled over HTTP by the
// operator remote (apps/web /control) instead of the WebSocket event stream.
// The Display still owns the socket; this is a read-only window for a second
// device that drives the same session.
export interface ControlSnapshot {
  liveSessionId: LiveSessionId;
  scene: SonaraSceneState;
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
  // Wall-clock ms when the live Session was constructed.
  startedAt: number;
}

// The slice of a live Session an operator can drive remotely over HTTP. The
// concrete Session (apps/server) satisfies this structurally; defining it here
// keeps the api package framework-agnostic (same rationale as SessionLike).
export interface ControllableSession {
  readonly userId: string | null;
  readonly liveSessionId: LiveSessionId;
  applyPatch(patch: ClientScenePatch, origin?: "client" | "voice"): void;
  goLive(prompt: string, seedFrameUrl: string | null): void;
  setDemoMode(on: boolean, deck: DeckKey | null): void;
  setImageAnchor(
    input: { url: string; strength: number } | { clear: true }
  ): void;
  setCurrentFrame(url: string): void;
  reset(): void;
  getControlSnapshot(): ControlSnapshot;
  // Push a `stage.status` event to this session's projector — emitted by the
  // control router when the owner opens/closes the Monad crowd stage.
  notifyStage(room: string | null, allowPrompts?: boolean): void;
}

// Lookup surface over the live in-memory sessions. apps/server's
// SessionManager implements this and is threaded into the HTTP context so the
// authed `control` router can find the caller's own live session(s).
export interface SessionRegistry {
  // rawUserId is the raw UUID (matching Session.userId), NOT the typeid.
  listByUserId(rawUserId: string): ControllableSession[];
  getByLiveSessionId(liveSessionId: string): ControllableSession | undefined;
}
