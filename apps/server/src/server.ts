import { Hono } from "hono";
import {
  buildContext,
  RPCHandler,
  sessionRouter,
  WsRPCHandler,
  type SessionContext,
} from "@sonara/api/server";
import { createDb } from "@sonara/db";
import { runMigrations } from "@sonara/db/migrator";
import { verifyTicket } from "@sonara/shared";
import type { UserId } from "@sonara/shared/typeid";
import { getAuth } from "./auth/auth";
import { seedLibraryOnBoot } from "./db/library-boot-seed";
import { env } from "./env";
import { uploadImage } from "./http/upload";
import { logger } from "./lib/logger";
import { appRouter } from "./rpc/app.router";
import { SessionManager } from "./session/session-manager";

// Apply pending schema migrations before binding the HTTP port. Matches
// ai-stilist / zednabi-v2 / invok admin-api — Railway re-runs this on every
// deploy; identical migrations are no-ops via drizzle's `__drizzle_migrations`
// bookkeeping table.
logger.info("running database migrations");
await runMigrations(env.DATABASE_URL);
logger.info("migrations applied");

// Sync the committed demo library into image_library. Idempotent — short-
// circuits when the row count already covers the seed. Keeps prod (and any
// fresh local DB) usable for DEMO mode with no manual railway-run.
await seedLibraryOnBoot(logger);

const port = env.PORT;

const app = new Hono();

// Shared singletons for the HTTP surface. The auth instance owns its own db
// pool (Better Auth + Dodo webhook); a second pool backs the oRPC context.
// createDb pools per connection string, so this is cheap.
const auth = getAuth();
const db = createDb(env.DATABASE_URL);
const rpcHandler = new RPCHandler(appRouter);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) =>
  c.text("sonara server — connect to /ws via WebSocket"),
);

// Better Auth owns every /api/auth/* path (sign-up, session, sign-out, and
// the Dodo webhook at /api/auth/dodopayments/webhook). Reached from the
// browser same-origin through the gateway, so cookies are first-party.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Image-anchor upload (multipart → fal storage).
app.post("/api/upload/image", (c) => uploadImage(c.req.raw));

// oRPC HTTP router (credits, mintWsTicket). Build the context per request
// from the Better Auth session, then delegate to the oRPC fetch handler.
app.all("/rpc/*", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const context = buildContext({
    db,
    session: session ? { user: { id: session.user.id as UserId } } : null,
  });
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    prefix: "/rpc",
    context,
  });
  if (matched) return response;
  return c.notFound();
});

const manager = new SessionManager(logger);

// One oRPC handler for the whole session surface. Bun's websocket hooks
// delegate message/close routing to this handler; the per-connection
// context pulls the Session instance from the manager using sessionId from
// ws.data.
const wsHandler = new WsRPCHandler<SessionContext>(sessionRouter);

interface WsData {
  sessionId: string;
  // raw UUID for authenticated users; null for anonymous demo sessions.
  // An anon ticket is still HMAC-signed by the web app — null just means
  // "the visitor wasn't signed in when they minted this ticket."
  userId: string | null;
}

const server = Bun.serve<WsData, never>({
  port,
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      // Require a short-lived HMAC ticket minted by apps/web after sign-in.
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
