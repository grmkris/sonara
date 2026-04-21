// Server-side surface. Consumers mount the router via RPCHandler and can
// build their own procedures via `os.$context<...>()`.
export { RPCHandler } from "@orpc/server/fetch";
export { ORPCError, os } from "@orpc/server";
export { appRouter, type AppRouter } from "./routers/app-router";
export { buildContext, type ApiContext, type ApiSession } from "./context";
