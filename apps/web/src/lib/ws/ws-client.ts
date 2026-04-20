import {
  type ClientEvent,
  type ServerEvent,
  ServerEvent as ServerEventSchema,
} from "@music-visualizer/shared";

export interface WsClientOpts {
  url: string;
  sessionId: string;
  onEvent: (event: ServerEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
}

export class WsClient {
  private ws: WebSocket | null = null;
  private readonly opts: WsClientOpts;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 500;

  constructor(opts: WsClientOpts) {
    this.opts = opts;
  }

  connect(): void {
    if (this.closed) return;
    const url = new URL(this.opts.url);
    url.searchParams.set("sessionId", this.opts.sessionId);
    const ws = new WebSocket(url.toString());
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.backoffMs = 500;
      this.opts.onOpen?.();
      this.send({ type: "hello", sessionId: this.opts.sessionId });
    });

    ws.addEventListener("message", (ev) => {
      try {
        const parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "{}");
        const result = ServerEventSchema.safeParse(parsed);
        if (result.success) this.opts.onEvent(result.data);
      } catch {
        // ignore malformed frames
      }
    });

    const scheduleReconnect = () => {
      this.ws = null;
      this.opts.onClose?.();
      if (this.closed) return;
      const delay = this.backoffMs;
      this.backoffMs = Math.min(this.backoffMs * 2, 8000);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };

    ws.addEventListener("close", scheduleReconnect);
    ws.addEventListener("error", () => {
      try {
        ws.close();
      } catch {
        // noop
      }
    });
  }

  send(event: ClientEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      this.ws.send(JSON.stringify(event));
    } catch {
      // ignore send errors; reconnect will pick up
    }
  }

  close(): void {
    this.closed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // noop
      }
      this.ws = null;
    }
  }
}
