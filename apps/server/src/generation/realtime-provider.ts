import { createFalClient } from "@fal-ai/client";

import { env } from "../env";
import type { Logger } from "../lib/logger";
import type { FrameStreamCallbacks } from "./fal-provider";
import {
  TOKEN_EXPIRATION_SECONDS_CONST,
  cachedTokenProvider,
} from "./fal-token";

// Realtime text-mode generation. Where `fal-provider.ts` routes each frame
// through fal's job QUEUE (submit → poll → result, multi-second), this path
// holds a WARM websocket per model via `fal.realtime.connect`: the runner
// stays hot across messages, so every frame after the first hits fal's
// ~150-300ms warm floor instead of paying queue + cold-start each time. That
// is the live-session latency win.
//
// Same text-to-image invariant as the queue path: no `image_url`, no identity
// lock — a prompt change pivots the very next frame (the image-anchor path in
// `anchor-provider.ts` is the only one that conditions on a reference image).
//
// Lifecycle: ONE pool per Session. Connections open lazily on first send and
// are reused across frames (keyed by fal model id, so an A/B model switch just
// opens a second warm connection). The Session MUST call close() on teardown —
// nothing closes the sockets for us. fal does not auto-reconnect; on a dropped
// socket the next send() re-opens (and pays one cold start).

interface FalImage {
  url?: string;
  // Realtime endpoints return the image INLINE as raw bytes (no CDN url) —
  // that's how they avoid the upload/CDN round-trip. msgpack-decoded, this is
  // a Uint8Array/Buffer (or a {data:number[]} shell).
  content?: unknown;
  content_type?: string;
}
interface FalRealtimeResult {
  request_id?: string;
  images?: FalImage[];
  image?: FalImage;
}

export interface RealtimeStreamInput extends FrameStreamCallbacks {
  prompt: string;
  seed?: number;
  // fal endpoint id of a realtime-capable model (e.g. fal-ai/fast-lightning-sdxl).
  falModelId: string;
  steps: number;
  // CFG scale, when a model takes one. Omitted for lightning-sdxl.
  guidanceScale?: number;
  size: { width: number; height: number };
}

type FalClient = ReturnType<typeof createFalClient>;
type RealtimeConnection = ReturnType<FalClient["realtime"]["connect"]>;

interface PendingRequest {
  onFinal: (url: string) => void;
  onPreview: (url: string) => void;
  onError: (err: unknown) => void;
  settled: boolean;
  detach: () => void;
}

interface PooledConnection {
  conn: RealtimeConnection;
  pending: Map<string, PendingRequest>;
}

// Coerce whatever shape the msgpack-decoded `content` took into bytes.
const toBytes = (content: unknown): Uint8Array | undefined => {
  if (content instanceof Uint8Array) {
    return content;
  }
  if (content instanceof ArrayBuffer) {
    return new Uint8Array(content);
  }
  if (Array.isArray(content)) {
    return Uint8Array.from(content as number[]);
  }
  if (typeof content === "object" && content !== null && "data" in content) {
    const { data } = content as { data: unknown };
    if (data instanceof Uint8Array) {
      return data;
    }
    if (Array.isArray(data)) {
      return Uint8Array.from(data as number[]);
    }
  }
  return undefined;
};

// Realtime frames come back either as a CDN url (rare) or — for the
// lightning endpoint — inline bytes. Turn either into something the
// browser <img> can render: a CDN url passes through; inline bytes become a
// base64 `data:` URI (no upload, keeps the realtime latency win). persistFrame
// later fetch()es this URI (Bun supports data: URIs) to back it up to S3.
const extractUrl = (result: FalRealtimeResult): string | undefined => {
  const img = result.image ?? result.images?.[0];
  if (!img) {
    return undefined;
  }
  if (typeof img.url === "string" && img.url.length > 0) {
    return img.url;
  }
  const bytes = toBytes(img.content);
  if (!bytes) {
    return undefined;
  }
  const contentType =
    typeof img.content_type === "string" && img.content_type.length > 0
      ? img.content_type
      : "image/jpeg";
  return `data:${contentType};base64,${Buffer.from(bytes).toString("base64")}`;
};

export class RealtimeImagePool {
  private readonly client: FalClient;
  private readonly logger: Logger;
  private readonly connections = new Map<string, PooledConnection>();
  private closed = false;

  constructor(logger: Logger) {
    this.logger = logger;
    // One scoped client per pool (per session) — no global singleton, matching
    // fal-provider's rationale (avoids cross-session credential races).
    this.client = createFalClient({ credentials: env.FAL_KEY });
  }

  private getConnection(modelId: string): PooledConnection {
    const existing = this.connections.get(modelId);
    if (existing) {
      return existing;
    }
    const pending = new Map<string, PendingRequest>();
    const conn = this.client.realtime.connect(modelId, {
      connectionKey: modelId,
      onError: (err: unknown) => {
        // Connection-level failure (auth, socket drop): fail every in-flight
        // request on this connection so the session refunds + the next trigger
        // re-opens. Drop the cached connection so getConnection re-dials.
        this.connections.delete(modelId);
        for (const [requestId, req] of pending) {
          pending.delete(requestId);
          if (req.settled) {
            continue;
          }
          req.settled = true;
          req.detach();
          req.onError(err);
        }
      },
      onResult: (result: FalRealtimeResult) => {
        const url = extractUrl(result);
        const rid = result.request_id;
        // Match by the echoed request_id; fall back to the sole in-flight
        // request when the endpoint doesn't echo one (we supersede on every
        // trigger, so there's normally ≤1 pending per connection). Without
        // this fallback a non-echoing endpoint would silently drop every frame.
        let key: string | undefined;
        if (typeof rid === "string" && pending.has(rid)) {
          key = rid;
        } else if (pending.size === 1) {
          key = pending.keys().next().value;
        }
        this.logger.info(
          {
            hasUrl: Boolean(url),
            matchedKey: key ?? null,
            model: modelId,
            pending: pending.size,
            requestId: rid ?? null,
          },
          "fal realtime result"
        );
        if (key === undefined) {
          // Couldn't correlate (no id + multiple/zero pending). Drop.
          return;
        }
        const req = pending.get(key);
        if (!req || req.settled) {
          // Stale (superseded/aborted — pending already removed) or a duplicate
          // frame for an already-settled request. Drop it.
          return;
        }
        if (url === undefined) {
          // A non-image frame (keepalive / partial). Wait for one with a url.
          return;
        }
        pending.delete(key);
        req.settled = true;
        req.detach();
        // These models return a single settled frame per send, so preview and
        // final are the same URL — matches the queue path's onPreview→onFinal.
        req.onPreview(url);
        req.onFinal(url);
      },
      // 0 disables the SDK's send() throttle entirely (it does `throttleInterval
      // > 0 ? throttle(...) : service.send`). We pace ourselves and supersede on
      // each trigger, so the throttle only added a negative-setTimeout warning
      // under Bun (calls are seconds apart) with no benefit.
      throttleInterval: 0,
      // Supplying tokenExpirationSeconds enables the SDK's background token
      // refresh (at 90% of this) instead of a lazy re-auth mid-stream.
      tokenExpirationSeconds: TOKEN_EXPIRATION_SECONDS_CONST,
      // Our cached provider reuses one token per fal app across sessions, so the
      // warm websocket stops re-authenticating every frame (the real ~1s cost).
      tokenProvider: cachedTokenProvider,
    });
    const pooled: PooledConnection = { conn, pending };
    this.connections.set(modelId, pooled);
    return pooled;
  }

  stream(input: RealtimeStreamInput): void {
    if (this.closed) {
      input.onError(new Error("realtime pool closed"));
      return;
    }
    if (input.signal.aborted) {
      input.onError(new DOMException("aborted", "AbortError"));
      return;
    }

    const pooled = this.getConnection(input.falModelId);
    const requestId = crypto.randomUUID();

    const req: PendingRequest = {
      detach: () => {
        // replaced below once `onAbort` is defined
      },
      onError: input.onError,
      onFinal: input.onFinal,
      onPreview: input.onPreview,
      settled: false,
    };

    const onAbort = () => {
      if (req.settled) {
        return;
      }
      req.settled = true;
      pooled.pending.delete(requestId);
      // The fal generation may still complete server-side; its result is
      // dropped (pending already removed). Route abort through onError so the
      // session refunds the credit, exactly like the queue path.
      input.onError(new DOMException("aborted", "AbortError"));
    };
    req.detach = () => input.signal.removeEventListener("abort", onAbort);
    input.signal.addEventListener("abort", onAbort, { once: true });

    pooled.pending.set(requestId, req);

    const payload: Record<string, unknown> = {
      enable_safety_checker: false,
      format: "jpeg",
      image_size: { height: input.size.height, width: input.size.width },
      num_images: 1,
      num_inference_steps: input.steps,
      prompt: input.prompt,
      request_id: requestId,
      // false → result carries images[].url (a fal CDN url), keeping the rest
      // of the pipeline (crossfade, persist) URL-based. sync_mode:true would
      // inline the bytes and force an upload step.
      sync_mode: false,
    };
    if (typeof input.guidanceScale === "number") {
      payload.guidance_scale = input.guidanceScale;
    }
    if (typeof input.seed === "number") {
      payload.seed = input.seed;
    }

    input.logger.info(
      { model: input.falModelId, requestId },
      "fal realtime send"
    );
    try {
      pooled.conn.send(payload);
    } catch (error) {
      if (!req.settled) {
        req.settled = true;
        pooled.pending.delete(requestId);
        req.detach();
        input.onError(error);
      }
    }
  }

  close(): void {
    this.closed = true;
    for (const { conn, pending } of this.connections.values()) {
      for (const req of pending.values()) {
        req.detach();
      }
      pending.clear();
      try {
        conn.close();
      } catch {
        // best-effort teardown
      }
    }
    this.connections.clear();
  }
}
