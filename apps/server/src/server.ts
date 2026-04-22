import { Hono } from "hono";
import {
  ClientEvent,
  ServerEvent,
  verifyTicket,
} from "@music-visualizer/shared";
import { env } from "./env";
import { logger } from "./lib/logger";
import { SessionManager } from "./session/session-manager";

const port = env.PORT;
const isDev = env.NODE_ENV !== "production";
const BETTER_AUTH_SECRET = env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) {
  logger.warn(
    "BETTER_AUTH_SECRET not set — WS upgrades will be rejected until it is",
  );
}

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) =>
  c.text("music-visualizer server — connect to /ws via WebSocket"),
);

const manager = new SessionManager(logger);

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
      if (!BETTER_AUTH_SECRET) {
        return new Response("server not configured", { status: 503 });
      }
      const token = url.searchParams.get("token");
      if (!token) {
        return new Response("missing token", { status: 401 });
      }
      const payload = await verifyTicket(token, BETTER_AUTH_SECRET);
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
      const session = manager.create(sessionId, userId, (event: ServerEvent) => {
        if (isDev) {
          const check = ServerEvent.safeParse(event);
          if (!check.success) {
            logger.error(
              { issues: check.error.issues, type: (event as { type?: unknown }).type, sessionId },
              "outbound ServerEvent failed validation — dropped",
            );
            return;
          }
        }
        try {
          ws.send(JSON.stringify(event));
        } catch (err) {
          logger.warn({ err, sessionId }, "ws send failed");
        }
      });
      logger.info({ sessionId, userId }, "ws opened");
      session.init();
    },
    message(ws, raw) {
      const { sessionId } = ws.data;
      const session = manager.get(sessionId);
      if (!session) {
        logger.warn({ sessionId }, "message with no session");
        return;
      }
      let parsed: unknown;
      try {
        const text =
          typeof raw === "string"
            ? raw
            : new TextDecoder().decode(
                raw instanceof ArrayBuffer
                  ? raw
                  : new Uint8Array(
                      raw.buffer,
                      raw.byteOffset,
                      raw.byteLength,
                    ),
              );
        parsed = JSON.parse(text);
      } catch (err) {
        logger.warn({ err, sessionId }, "ws message parse error");
        return;
      }
      const result = ClientEvent.safeParse(parsed);
      if (!result.success) {
        logger.warn(
          { issues: result.error.issues, sessionId },
          "invalid ClientEvent",
        );
        return;
      }
      const event = result.data;
      switch (event.type) {
        case "hello":
          session.init({ falKey: event.falKey });
          break;
        case "scene.patch":
          session.applyPatch(event.patch);
          break;
        case "audio.features":
          session.applyAudio(event.features);
          break;
        case "generate.commit":
          session.commit();
          break;
        case "session.reset":
          session.reset();
          break;
        case "voice.phrase":
          session.applyVoice(event.text);
          break;
        case "audio.recognize":
          session
            .recognize(event.clipBase64, event.mimeType, event.trigger)
            .catch((err) => {
              logger.warn({ err, sessionId }, "session.recognize threw");
            });
          break;
      }
    },
    close(ws) {
      const { sessionId } = ws.data;
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
