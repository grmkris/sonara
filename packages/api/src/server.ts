// Server-side surface. Consumers mount the router via RPCHandler.
export { RPCHandler } from "@orpc/server/fetch";
export { ORPCError } from "@orpc/server";
export { appRouter, type AppRouter } from "./routers/app-router";
export { buildContext, type ApiContext, type ApiSession } from "./context";
