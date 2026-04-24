import ReconnectingWebSocket from "partysocket/ws";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import type { SessionRouterClient } from "@music-visualizer/api";
import { rpcClient } from "./orpc";

// One WebSocket per tab, wrapping an oRPC client that speaks the `session`
// router (apps/server mounts the matching RPCHandler on /ws). partysocket's
// ReconnectingWebSocket handles exponential backoff and, critically, calls
// the URL provider on every (re)connect — so we mint a fresh HMAC ticket
// each time without any bespoke reconnect glue.

const WS_URL_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:4471/ws";

export interface SessionConnection {
  socket: ReconnectingWebSocket;
  client: SessionRouterClient;
}

export function createSessionConnection(
  sessionId: string,
): SessionConnection {
  const urlProvider = async (): Promise<string> => {
    // rpcClient.auth.mintWsTicket throws ORPCError("UNAUTHORIZED") if the
    // user isn't signed in. Let it propagate; ReconnectingWebSocket surfaces
    // it as an error and keeps retrying with backoff, which matches the
    // behaviour of the old fetch-based flow.
    const { token } = await rpcClient.auth.mintWsTicket();
    const url = new URL(WS_URL_BASE);
    url.searchParams.set("token", token);
    url.searchParams.set("sessionId", sessionId);
    return url.toString();
  };

  const socket = new ReconnectingWebSocket(urlProvider, undefined, {
    // Sane reconnect defaults; override if UX demands faster/slower.
    minReconnectionDelay: 500,
    maxReconnectionDelay: 8000,
    reconnectionDelayGrowFactor: 2,
  });

  const link = new RPCLink({
    websocket: socket as unknown as WebSocket,
  });

  const client: SessionRouterClient = createORPCClient(link);
  return { socket, client };
}
