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

export const createSessionConnection = (
  sessionId: string,
  // Durable logical-performance id (sessionStorage, owned by the client). Sent
  // on every (re)connect so the server keeps grouping persisted frames under
  // one session across reconnects/reloads/redeploys. partysocket re-invokes the
  // url provider on each reconnect, so the same id rides along automatically.
  liveSessionId: string
): SessionConnection => {
  const urlProvider = async (): Promise<string> => {
    // mintWsTicket is public: signed-in visitors get a ticket carrying
    // their uuid; everyone else gets an anon ticket (userId: null) which
    // pins the server-side Session to demo-library mode. Either way the
    // socket opens — no auth-gated UNAUTHORIZED branch to handle here.
    const { token } = await rpcClient.auth.mintWsTicket();
    const url = new URL(WS_URL_BASE);
    url.searchParams.set("token", token);
    url.searchParams.set("sessionId", sessionId);
    url.searchParams.set("liveSessionId", liveSessionId);
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
