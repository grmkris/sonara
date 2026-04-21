// Client-side surface. Consumers build an RPCLink + createORPCClient.
export { createORPCClient } from "@orpc/client";
export { RPCLink } from "@orpc/client/fetch";
export type { AppRouter, AppRouterClient } from "./routers/app-router";
