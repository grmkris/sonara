import {
  buildContext,
  RPCHandler,
  sessionRouter,
  WsRPCHandler,
} from "@sonara/api/server";
import type { SessionContext } from "@sonara/api/server";
import { createDb } from "@sonara/db";
import { runMigrations } from "@sonara/db/migrator";
import { SERVICE_URLS, verifyTicket } from "@sonara/shared";
import { LiveSessionIdSchema } from "@sonara/shared/typeid";
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";

import { isAddress } from "viem";

import { getAuth } from "./auth/auth";
import { migrateFrameSetsOnBoot } from "./db/frame-set-boot-migrate";
import { seedLibraryOnBoot } from "./db/library-boot-seed";
import { env } from "./env";
import { uploadImage } from "./http/upload";
import { logger } from "./lib/logger";
import { createStageListener } from "./onchain/stage-listener";
import { createStageMcp } from "./onchain/mcp-server";
import { stageFaucet } from "./onchain/stage-faucet";
import {
  bindStagePublisher,
  stageFeedHooks,
  tryUpgradeStageFeed,
} from "./onchain/stage-feed";
import type { StageFeedWsData } from "./onchain/stage-feed";
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

// Converge decks / derived sessions / reels into the unified frame_set
// tables (idempotent; see frame-set-boot-migrate.ts). Must run after the
// library seed so builtin sets pick up the seed frames.
await migrateFrameSetsOnBoot(logger);

const port = env.PORT;

const app = new Hono();

// Shared singletons for the HTTP surface. The auth instance owns its own db
// pool (Better Auth + Dodo webhook); a second pool backs the oRPC context.
// createDb pools per connection string, so this is cheap.
const auth = getAuth();
const db = createDb(env.DATABASE_URL);
const rpcHandler = new RPCHandler(appRouter);

// Live in-memory sessions. Created/destroyed by the WS lifecycle below, and
// also threaded into the HTTP context so the authed `control` router can find
// a user's own live session from a second device (the operator remote).
const manager = new SessionManager(logger);

// Monad "stage": when a contract address is configured, subscribe to its
// on-chain events and fold them into the live Sessions (the crowd / AI agents
// drive the visuals). Dormant when SONARA_STAGE_CONTRACT is empty.
const stageListener =
  env.SONARA_STAGE_CONTRACT && isAddress(env.SONARA_STAGE_CONTRACT)
    ? createStageListener({
        contract: env.SONARA_STAGE_CONTRACT,
        dwellMs: env.PROMPT_DWELL_MS,
        logger,
        registry: manager,
        wssUrl: env.MONAD_RPC_WSS,
      })
    : null;

// Stage airdrop faucet (control.stageAirdrop): tops audience wallets up with
// USDC so they can prompt without leaving the show. Dormant without a key.
if (
  env.SONARA_STAGE_CONTRACT &&
  isAddress(env.SONARA_STAGE_CONTRACT) &&
  /^0x[0-9a-fA-F]{64}$/u.test(env.STAGE_FAUCET_KEY)
) {
  stageFaucet.configure({
    contract: env.SONARA_STAGE_CONTRACT,
    faucetKey: env.STAGE_FAUCET_KEY as `0x${string}`,
    logger,
  });
}

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) => c.text("sonara server — connect to /ws via WebSocket"));

// Better Auth owns every /api/auth/* path (sign-up, session, sign-out, and
// the Dodo webhook at /api/auth/dodopayments/webhook). Reached from the
// browser same-origin through the gateway, so cookies are first-party.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Image-anchor upload (multipart → fal storage).
app.post("/api/upload/image", (c) => uploadImage(c.req.raw));

// MCP server (/api/mcp) — an AI agent drives a stage room via on-chain txs,
// signed by the agent EOA (MCP_AGENT_KEY). Mounted only when both the contract
// and the agent key are configured. The room code is the capability.
const stageMcp =
  env.SONARA_STAGE_CONTRACT &&
  isAddress(env.SONARA_STAGE_CONTRACT) &&
  /^0x[0-9a-fA-F]{64}$/u.test(env.MCP_AGENT_KEY)
    ? createStageMcp({
        agentKey: env.MCP_AGENT_KEY as `0x${string}`,
        contract: env.SONARA_STAGE_CONTRACT,
        logger,
      })
    : null;
if (stageMcp) {
  app.all("/api/mcp", (c) => stageMcp(c));
}

// oRPC HTTP router (credits, mintWsTicket). Build the context per request
// from the Better Auth session, then delegate to the oRPC fetch handler.
app.all("/rpc/*", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const context = buildContext({
    db,
    registry: manager,
    session: session ? { user: { id: session.user.id as UserId } } : null,
  });
  const { matched, response } = await rpcHandler.handle(c.req.raw, {
    context,
    prefix: "/rpc",
  });
  if (matched) {
    return response;
  }
  return c.notFound();
});

// One oRPC handler for the whole session surface. Bun's websocket hooks
// delegate message/close routing to this handler; the per-connection
// context pulls the Session instance from the manager using sessionId from
// ws.data.
const wsHandler = new WsRPCHandler<SessionContext>(sessionRouter);

interface SessionWsData {
  kind: "session";
  sessionId: string;
  // raw UUID for authenticated users; null for anonymous demo sessions.
  // An anon ticket is still HMAC-signed by the web app — null just means
  // "the visitor wasn't signed in when they minted this ticket."
  userId: string | null;
  // Durable logical-performance id the client owns (sessionStorage) and
  // re-sends on every reconnect, so persisted frames keep grouping under one
  // session_id. Validated as a well-formed liveSession typeid; null when a
  // client doesn't supply one (old/direct client) → the Session mints its own.
  liveSessionId: LiveSessionId | null;
}

// One Bun.serve handles two socket kinds: the oRPC session wire (/ws) and the
// public read-only stage feed (/ws/stage). The hooks below branch on `kind`.
type WsData = SessionWsData | StageFeedWsData;

const server = Bun.serve<WsData, never>({
  async fetch(req, srv) {
    const url = new URL(req.url);
    // Public per-room stage feed — no ticket; the room code is the capability
    // (same trust model as control.stageSnapshot). All logic lives in
    // onchain/stage-feed.ts.
    if (url.pathname === "/ws/stage") {
      return tryUpgradeStageFeed(req, srv);
    }
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
      // The client owns a durable liveSessionId (sessionStorage) and re-sends
      // it on every reconnect. Validate it's a well-formed liveSession typeid
      // before trusting it; a malformed/absent value falls back to a fresh mint
      // server-side. It's only a grouping key — every persisted frame still
      // carries the authenticated user_id, so a client can only group its own.
      const liveSessionIdRaw = url.searchParams.get("liveSessionId");
      const liveSessionParse = liveSessionIdRaw
        ? LiveSessionIdSchema.safeParse(liveSessionIdRaw)
        : null;
      const liveSessionId = liveSessionParse?.success
        ? liveSessionParse.data
        : null;
      const upgraded = srv.upgrade(req, {
        data: {
          kind: "session" as const,
          liveSessionId,
          sessionId,
          userId: payload.userId,
        },
      });
      return upgraded
        ? undefined
        : new Response("upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  // Dual-stack bind so Railway's private network (gateway → server.railway.internal) reaches us.
  hostname: "::",
  port,
  websocket: {
    close(ws) {
      // Narrowing ws.data doesn't narrow the ServerWebSocket wrapper — cast
      // behind the kind guard.
      if (ws.data.kind === "stage") {
        stageFeedHooks.close(ws as ServerWebSocket<StageFeedWsData>);
        return;
      }
      const { sessionId } = ws.data;
      wsHandler.close(ws);
      manager.destroy(sessionId);
      logger.info({ sessionId }, "ws closed");
    },
    async message(ws, raw) {
      // Stage feed sockets are read-only — clients have nothing to say.
      if (ws.data.kind === "stage") {
        return;
      }
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
    open(ws) {
      if (ws.data.kind === "stage") {
        stageFeedHooks.open(ws as ServerWebSocket<StageFeedWsData>);
        return;
      }
      const { liveSessionId, sessionId, userId } = ws.data;
      manager.create(sessionId, userId, liveSessionId);
      logger.info({ liveSessionId, sessionId, userId }, "ws opened");
    },
  },
});

// Late-bind server.publish into the stage feed: the listener exists before
// Bun.serve returns, so feed publishes no-op (but still record) until here.
bindStagePublisher(server);

logger.info(
  { appEnv: env.APP_ENV, port, wsUrl: SERVICE_URLS[env.APP_ENV].ws },
  "server listening"
);

process.on("SIGTERM", () => {
  logger.info("SIGTERM received, shutting down");
  stageListener?.close();
  server.stop();
  process.exit(0);
});
process.on("SIGINT", () => {
  logger.info("SIGINT received, shutting down");
  stageListener?.close();
  server.stop();
  process.exit(0);
});
