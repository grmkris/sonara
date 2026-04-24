import { env } from "../../env";
import type { Logger } from "../../lib/logger";
import { DeepgramSttSession } from "./deepgram-provider";

// Per-session STT relay. Picks the provider at start() time based on the
// server env: with DEEPGRAM_API_KEY set we open a Flux (listen v2) WS;
// without it the relay is a no-op and the client uses Web Speech locally.
//
// The Session class owns one of these and forwards audio* router calls to
// it. STT-side partials/finals fan out via deps.onPartial back to the
// VoiceController, which then emits voice.partial / voice.parsed /
// voice.applied on the WS event stream.
//
// Audio-forwarding gate: the session drives `setForwardAudio(on)` to honour
// the client's voice mode. In Live mode it stays `true`; in PTT mode it
// flips `true` on voice.ptt.start and `false` on voice.ptt.end so ambient
// speech between presses doesn't reach Flux.

export interface SttServiceDeps {
  logger: Logger;
  onPartial: (opts: {
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "deepgram";
  }) => void;
  // Called when Flux emits a high-confidence EndOfTurn event. Session routes
  // this to VoiceController.commitNow() so the LLM intent dispatches without
  // waiting for the 1.5s debounce.
  onEndOfTurn: (opts: { transcript: string; confidence: number }) => void;
}

export class SttService {
  private session: DeepgramSttSession | null = null;
  private forwardAudio = true;
  // Soft per-session cap on streaming time. Avoids runaway cost if the
  // client forgets to call audioStop. 30 minutes is generous for a single
  // voice session; production monitoring would tune this lower.
  private startedAt = 0;
  private readonly MAX_SESSION_MS = 30 * 60_000;

  constructor(private readonly deps: SttServiceDeps) {}

  isEnabled(): boolean {
    return Boolean(env.DEEPGRAM_API_KEY);
  }

  start(opts: { sampleRate: number }): void {
    if (!env.DEEPGRAM_API_KEY) {
      this.deps.logger.debug("stt: no DEEPGRAM_API_KEY, relay disabled");
      return;
    }
    this.stop();
    this.startedAt = Date.now();
    this.session = new DeepgramSttSession({
      apiKey: env.DEEPGRAM_API_KEY,
      model: env.DEEPGRAM_STT_MODEL,
      sampleRate: opts.sampleRate,
      eotThreshold: env.DEEPGRAM_EOT_THRESHOLD,
      eotTimeoutMs: env.DEEPGRAM_EOT_TIMEOUT_MS,
      logger: this.deps.logger,
      onPartial: this.deps.onPartial,
      onEndOfTurn: this.deps.onEndOfTurn,
      onError: (err) => {
        this.deps.logger.warn({ err }, "stt: session error, closing");
        this.stop();
      },
    });
    this.session.connect();
    this.deps.logger.info(
      {
        sampleRate: opts.sampleRate,
        model: env.DEEPGRAM_STT_MODEL,
        eotThreshold: env.DEEPGRAM_EOT_THRESHOLD,
      },
      "stt: relay started",
    );
  }

  push(base64: string): void {
    if (!this.session) return;
    if (!this.forwardAudio) return;
    if (Date.now() - this.startedAt > this.MAX_SESSION_MS) {
      this.deps.logger.warn(
        { ms: Date.now() - this.startedAt },
        "stt: session exceeded max duration, closing",
      );
      this.stop();
      return;
    }
    this.session.push(base64);
  }

  // Toggles whether audio chunks reach Flux. The socket stays open so there's
  // no re-handshake cost; we just drop incoming frames at the relay boundary.
  // Session calls this for Live/PTT mode transitions and PTT keydown/keyup.
  setForwardAudio(on: boolean): void {
    if (this.forwardAudio === on) return;
    this.forwardAudio = on;
    this.deps.logger.debug({ forwardAudio: on }, "stt: forward gate");
  }

  stop(): void {
    if (this.session) {
      this.session.close();
      this.session = null;
      this.deps.logger.info(
        { ms: Date.now() - this.startedAt },
        "stt: relay stopped",
      );
    }
    this.startedAt = 0;
    this.forwardAudio = true;
  }
}
