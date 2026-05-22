import { createORPCClient, RPCLink } from "@sonara/api/client";
import type { AppRouterClient } from "server/rpc";

// HTTP oRPC client for the server's request/response surface (credits,
// mintWsTicket). In the browser it hits the current origin — the Caddy
// gateway proxies /rpc/* to the server, so it's same-origin (cookies are
// first-party). During SSR there's no window, so we reach the server
// directly over the internal network.
const link = new RPCLink({
  url:
    typeof window === "undefined"
      ? `${process.env.RPC_INTERNAL_URL ?? "http://localhost:4471"}/rpc`
      : `${window.location.origin}/rpc`,
  fetch(url, options) {
    return fetch(url, { ...options, credentials: "include" });
  },
});

export const rpcClient: AppRouterClient = createORPCClient(link);
