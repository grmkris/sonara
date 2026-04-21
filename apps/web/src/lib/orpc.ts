import {
  type AppRouterClient,
  createORPCClient,
  RPCLink,
} from "@music-visualizer/api/client";

const link = new RPCLink({
  url:
    typeof window === "undefined"
      ? "http://localhost:3000/rpc"
      : `${window.location.origin}/rpc`,
  fetch(url, options) {
    return fetch(url, { ...options, credentials: "include" });
  },
});

export const rpcClient: AppRouterClient = createORPCClient(link);
