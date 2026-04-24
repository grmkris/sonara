import { DeepgramClient, Deepgram } from "@deepgram/sdk";
import type { Logger } from "../../lib/logger";

// The SDK exposes the V2Socket class but doesn't re-export it through the
// top-level index — infer it from the client's `connect` return instead.
type V2Socket = Awaited<
  ReturnType<DeepgramClient["listen"]["v2"]["connect"]>
>;
type V2Message = Deepgram.listen.ListenV2Connected
  | Deepgram.listen.ListenV2TurnInfo
  | Deepgram.listen.ListenV2ConfigureSuccess
  | Deepgram.listen.ListenV2ConfigureFailure
  | Deepgram.listen.ListenV2FatalError;

// Deepgram Flux STT — built on @deepgram/sdk v5's listen.v2 client, which
// exposes Flux's model-integrated end-of-turn events. Replaces the previous
// ElevenLabs Scribe v2 Realtime provider, which had a known commit-timing
// bug where committed_transcript fired 10-15s after silence (LiveKit agents
// #4087). Flux's EndOfTurn events fire within ~300ms of the speaker stopping.
//
// The browser captures mic audio as base64-encoded PCM16 at 16 kHz mono and
// forwards it via orpc-ws audio.chunk. Each base64 chunk is decoded to a
// Uint8Array and sent as binary media to the Flux socket.
//
// Event model:
//   - StartOfTurn: user began speaking
//   - Update: additional transcript, turn ongoing
//   - EagerEndOfTurn: moderate confidence of end (opportunity to start work)
//   - TurnResumed: eager end was wrong, speech resumed
//   - EndOfTurn: high-confidence end — this is our commit signal

export interface DeepgramSttSessionOpts {
  apiKey: string;
  model: string; // expect "flux-general-en"
  sampleRate: number; // expect 16000
  eotThreshold: number; // 0..1, Deepgram recommends 0.7
  eotTimeoutMs: number; // force EOT after this much silence even if confidence low
  logger: Logger;
  onPartial: (opts: {
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "deepgram";
  }) => void;
  // Fires when Flux's EndOfTurn event arrives. Consumer should commit the
  // current utterance (flush any LLM debounce and dispatch immediately).
  // `transcript` is the full turn text as of commit time.
  onEndOfTurn: (opts: { transcript: string; confidence: number }) => void;
  onError?: (err: unknown) => void;
}

// Base64 decode to Uint8Array. Bun/Node both provide Buffer, but Buffer
// output is a subclass of Uint8Array so the SDK's sendMedia accepts it.
function b64ToBytes(b64: string): Uint8Array {
  return Buffer.from(b64, "base64");
}

export class DeepgramSttSession {
  private socket: V2Socket | null = null;
  private closed = false;
  // Frames pushed before the SDK's connect promise resolves buffer here and
  // drain once the socket opens. Cap keeps memory bounded if connect stalls.
  private readonly pending: Uint8Array[] = [];
  private static readonly PENDING_CAP = 64;

  constructor(private readonly opts: DeepgramSttSessionOpts) {}

  connect(): void {
    void this.connectAsync().catch((err) => {
      this.opts.logger.warn({ err }, "deepgram: connect crashed");
      this.opts.onError?.(err);
    });
  }

  push(base64: string): void {
    if (this.closed) return;
    const bytes = b64ToBytes(base64);
    if (!this.socket) {
      this.pending.push(bytes);
      if (this.pending.length > DeepgramSttSession.PENDING_CAP) {
        this.pending.shift();
      }
      return;
    }
    try {
      this.socket.sendMedia(bytes);
    } catch (err) {
      this.opts.logger.warn({ err }, "deepgram: sendMedia failed");
    }
  }

  close(): void {
    this.closed = true;
    if (this.socket) {
      try {
        this.socket.close();
      } catch (err) {
        this.opts.logger.debug({ err }, "deepgram: close threw");
      }
      this.socket = null;
    }
    this.pending.length = 0;
  }

  private async connectAsync(): Promise<void> {
    const client = new DeepgramClient({ apiKey: this.opts.apiKey });
    let socket: V2Socket;
    try {
      socket = await client.listen.v2.connect({
        // Cast: env-supplied string → SDK's specific string-literal union.
        // The SDK enumerates known models; env lets us override at runtime
        // without chasing SDK type churn every release.
        model: this.opts.model as Deepgram.ListenV2Model,
        encoding: "linear16",
        sample_rate: this.opts.sampleRate,
        eot_threshold: this.opts.eotThreshold,
        eot_timeout_ms: this.opts.eotTimeoutMs,
        Authorization: `Token ${this.opts.apiKey}`,
      });
    } catch (err) {
      this.opts.logger.warn({ err }, "deepgram: connect failed");
      this.opts.onError?.(err);
      return;
    }
    if (this.closed) {
      try {
        socket.close();
      } catch {
        /* ignore */
      }
      return;
    }
    this.socket = socket;

    socket.on("message", (message: V2Message) => {
      switch (message.type) {
        case "Connected":
          this.opts.logger.info(
            { requestId: (message as { request_id?: string }).request_id, model: this.opts.model },
            "deepgram: connected",
          );
          break;

        case "TurnInfo": {
          const text = message.transcript?.trim() ?? "";
          if (text.length === 0) break;
          switch (message.event) {
            case "StartOfTurn":
            case "Update":
            case "TurnResumed":
              // Interim transcript — route through onPartial as interim.
              this.opts.onPartial({
                text,
                isFinal: false,
                provider: "deepgram",
              });
              break;
            case "EagerEndOfTurn":
              // Moderate-confidence end. Surface as final partial so the UI
              // shows the completed text, but do NOT commit yet — Flux may
              // still send TurnResumed if the speaker continues.
              this.opts.onPartial({
                text,
                isFinal: true,
                confidence: message.end_of_turn_confidence,
                provider: "deepgram",
              });
              break;
            case "EndOfTurn":
              // High-confidence end — this is our commit signal. Emit one
              // final partial (so voice.partial trail updates) and then
              // fire onEndOfTurn so the VoiceController flushes any pending
              // debounce and dispatches the LLM intent immediately.
              this.opts.onPartial({
                text,
                isFinal: true,
                confidence: message.end_of_turn_confidence,
                provider: "deepgram",
              });
              this.opts.onEndOfTurn({
                transcript: text,
                confidence: message.end_of_turn_confidence,
              });
              break;
            default:
              // Unknown event type; log and continue so SDK schema drift
              // doesn't brick the session.
              this.opts.logger.debug(
                { event: message.event, text },
                "deepgram: unknown turn event",
              );
          }
          break;
        }

        case "ConfigureFailure":
          this.opts.logger.error(
            { message },
            "deepgram: configure failed",
          );
          this.opts.onError?.(message);
          this.close();
          break;

        case "Error":
          this.opts.logger.error({ message }, "deepgram: fatal error");
          this.opts.onError?.(message);
          this.close();
          break;

        case "ConfigureSuccess":
          this.opts.logger.debug({ message }, "deepgram: configure success");
          break;

        default:
          this.opts.logger.debug(
            { message },
            "deepgram: unhandled message type",
          );
      }
    });

    socket.on("error", (err: Error) => {
      this.opts.logger.warn({ err }, "deepgram: socket error");
      this.opts.onError?.(err);
    });

    socket.on("close", (event: { code: number; reason: string }) => {
      this.opts.logger.info(
        { code: event.code, reason: event.reason },
        "deepgram: closed",
      );
      this.socket = null;
    });

    // Drain any chunks that landed during the handshake.
    while (this.pending.length > 0) {
      const chunk = this.pending.shift();
      if (!chunk) continue;
      try {
        socket.sendMedia(chunk);
      } catch (err) {
        this.opts.logger.warn({ err }, "deepgram: drain sendMedia failed");
        break;
      }
    }
  }
}
