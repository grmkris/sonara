// Server-side surface. Consumers mount the router via one of the adapters:
//   - `RPCHandler` (HTTP fetch) for Next.js / Hono
//   - `WsRPCHandler` (Bun WebSocket) for apps/server's realtime surface
export { RPCHandler } from "@orpc/server/fetch";
export { RPCHandler as WsRPCHandler } from "@orpc/server/bun-ws";
export { EventPublisher, ORPCError, eventIterator, os } from "@orpc/server";
export { appRouter, type AppRouter } from "./routers/app.router";
export {
  sessionRouter,
  type SessionContext,
  type SessionLike,
  type SessionRouter,
} from "./routers/session.router";
export { buildContext, type ApiContext, type ApiSession } from "./context";
export {
  type ControllableSession,
  type ControlSnapshot,
  type JobStatus,
  type SessionRegistry,
  type SessionSource,
  type SessionSourceState,
} from "./session-registry";
