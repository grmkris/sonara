import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { SessionRouterClient } from "@sonara/api";
import { SERVICE_URLS } from "@sonara/shared";
import ReconnectingWebSocket from "partysocket/ws";

import { publicEnv } from "../env";
import { rpcClient } from "./orpc";

// One WebSocket per tab, wrapping an oRPC client that speaks the `session`
// router (apps/server mounts the matching RPCHandler on /ws). partysocket's
// ReconnectingWebSocket handles exponential backoff and, critically, calls
// the URL provider on every (re)connect — so we mint a fresh HMAC ticket
// each time without any bespoke reconnect glue.

// Same-origin through the Caddy gateway (4470 locally → /ws proxied to the
// server). The public wss:// origin is derived from the app environment.
const WS_URL_BASE = SERVICE_URLS[publicEnv.NEXT_PUBLIC_APP_ENV].ws;

export interface SessionConnection {
  socket: ReconnectingWebSocket;
  client: SessionRouterClient;
}

// Anon screens carry a localStorage-stable pseudo-stage id so a reload
// resumes the same demo run server-side. Never an lse_ typeid — it's an
// opaque registry key, not run identity (the server owns runs now).
const ANON_STAGE_STORAGE_KEY = "sonara.anonStageId";

const readOrMintAnonStageId = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const existing = window.localStorage.getItem(ANON_STAGE_STORAGE_KEY);
  if (existing && /^[A-Za-z0-9_-]{8,64}$/u.test(existing)) {
    return existing;
  }
  const minted = crypto.randomUUID().replaceAll("-", "").slice(0, 24);
  window.localStorage.setItem(ANON_STAGE_STORAGE_KEY, minted);
  return minted;
};

export const createSessionConnection = (
  sessionId: string,
  // Which stage this screen attaches to. Null = the caller's default stage
  // (resolved server-side at ticket mint; anon visitors fall back to their
  // localStorage pseudo-stage). A code (from /stage/<code>/screen) resolves
  // to an owned stageId before minting. Run identity (lse_) is server-owned —
  // the client learns it from the `run.started` event and never sends one.
  target: { code: string | null }
): SessionConnection => {
  const urlProvider = async (): Promise<string> => {
    // mintWsTicket is public: signed-in visitors get a ticket carrying their
    // uuid + resolved stage; everyone else gets an anon ticket (userId: null,
    // stageId: null) which pins the server-side Session to demo-library mode.
    let stageId: string | undefined;
    if (target.code) {
      const { stage } = await rpcClient.control.resolveStage({
        code: target.code,
      });
      // Unknown/foreign codes fall back to the default stage — the page's
      // own resolveStage gate surfaces the real error before mounting the
      // screen; this branch just keeps the reconnect path alive.
      stageId = stage?.isOwner ? stage.stageId : undefined;
    }
    const { token } = await rpcClient.auth.mintWsTicket(
      stageId ? { stageId } : undefined
    );
    const url = new URL(WS_URL_BASE);
    url.searchParams.set("token", token);
    url.searchParams.set("sessionId", sessionId);
    // Only meaningful for anon tickets; the server ignores it otherwise.
    const anonId = readOrMintAnonStageId();
    if (anonId) {
      url.searchParams.set("anonStageId", anonId);
    }
    return url.toString();
  };

  const socket = new ReconnectingWebSocket(urlProvider, undefined, {
    // Sane reconnect defaults; override if UX demands faster/slower.
    maxReconnectionDelay: 8000,
    minReconnectionDelay: 500,
    reconnectionDelayGrowFactor: 2,
  });

  const link = new RPCLink({
    websocket: socket as unknown as WebSocket,
  });

  const client: SessionRouterClient = createORPCClient(link);
  return { client, socket };
};
