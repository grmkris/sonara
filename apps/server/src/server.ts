import { Hono } from "hono";
import {
  sessionRouter,
  WsRPCHandler,
  type SessionContext,
} from "@music-visualizer/api/server";
import { verifyTicket } from "@music-visualizer/shared";
import { env } from "./env";
import { logger } from "./lib/logger";
import { SessionManager } from "./session/session-manager";

const port = env.PORT;

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) =>
  c.text("music-visualizer server — connect to /ws via WebSocket"),
);

const manager = new SessionManager(logger);

// One oRPC handler for the whole session surface. Bun's websocket hooks
// delegate message/close routing to this handler; the per-connection
// context pulls the Session instance from the manager using sessionId from
// ws.data.
const wsHandler = new WsRPCHandler<SessionContext>(sessionRouter);

interface WsData {
  sessionId: string;
  userId: string; // raw UUID, extracted from the signed ticket
}

const server = Bun.serve<WsData, never>({
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // Require a short-lived HMAC ticket minted by apps/web after SIWE.
      // No ticket → no connection, even if the user guesses the URL.
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response("missing token", { status: 401 });
      }
      const payload = await verifyTicket(token, env.BETTER_AUTH_SECRET);
      if (!payload) {
        return new Response("invalid or expired token", { status: 401 });
      }
      const sessionId =
        url.searchParams.get("sessionId") ??
        `sess_${Math.random().toString(36).slice(2, 10)}`;
      const upgraded = srv.upgrade(req, {
        data: { sessionId, userId: payload.userId },
      });
      return upgraded
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      const { sessionId, userId } = ws.data;
      manager.create(sessionId, userId);
      logger.info({ sessionId, userId }, "ws opened");
    },
    async message(ws, raw) {
      const { sessionId } = ws.data;
      const session = manager.get(sessionId);
      if (!session) {
        logger.warn({ sessionId }, "message with no session");
        return;
      }
      await wsHandler.message(ws, raw, {
        context: { session },
      });
    },
    close(ws) {
      const { sessionId } = ws.data;
      wsHandler.close(ws);
      manager.destroy(sessionId);
      logger.info({ sessionId }, "ws closed");
    },
  },
});

logger.info({ port, wsUrl: `ws://localhost:${port}/ws` }, "server listening");

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  server.stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down");
  server.stop();
  process.exit(0);
});
