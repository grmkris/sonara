import { createORPCClient, RPCLink } from "@music-visualizer/api/client";
import type { AppRouterClient } from "@/server/rpc/app-router";

const link = new RPCLink({
  url:
    typeof window === "undefined"
      ? "http://localhost:4470/rpc"
      : `${window.location.origin}/rpc`,
  fetch(url, options) {
    return fetch(url, { ...options, credentials: "include" });
  },
});

export const rpcClient: AppRouterClient = createORPCClient(link);
