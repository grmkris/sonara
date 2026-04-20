import { Hono } from "hono";
import { ClientEvent, type ServerEvent } from "@music-visualizer/shared";
import { logger } from "./lib/logger";
import { SessionManager } from "./session/session-manager";

const port = Number(process.env.PORT ?? 3001);

const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) =>
  c.text("music-visualizer server — connect to /ws via WebSocket"),
);

const manager = new SessionManager(logger);

interface WsData {
  sessionId: string;
}

const server = Bun.serve<WsData, never>({
  port,
  fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const sessionId =
        url.searchParams.get("sessionId") ??
        `sess_${Math.random().toString(36).slice(2, 10)}`;
      const upgraded = srv.upgrade(req, { data: { sessionId } });
      return upgraded
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      const { sessionId } = ws.data;
      const session = manager.create(sessionId, (event: ServerEvent) => {
        try {
          ws.send(JSON.stringify(event));
        } catch (err) {
          logger.warn({ err, sessionId }, "ws send failed");
        }
      });
      logger.info({ sessionId }, "ws opened");
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
          session.init();
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
