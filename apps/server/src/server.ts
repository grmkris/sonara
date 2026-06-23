import {
  buildContext,
  onError,
  ORPCError,
  RPCHandler,
  sessionRouter,
  WsRPCHandler,
} from "@sonara/api/server";
import type { SessionContext } from "@sonara/api/server";
import { createDb } from "@sonara/db";
import { runMigrations } from "@sonara/db/migrator";
import { SERVICE_URLS, verifyTicket } from "@sonara/shared";
import type { WsRole } from "@sonara/shared";
import { LiveSessionIdSchema } from "@sonara/shared/typeid";
import type { LiveSessionId, UserId } from "@sonara/shared/typeid";
import type { ServerWebSocket } from "bun";
import { Hono } from "hono";

import { getAuth } from "./auth/auth";
import { getDb } from "./db/db";
import { migrateFrameSetsOnBoot } from "./db/frame-set-boot-migrate";
import { seedLibraryOnBoot } from "./db/library-boot-seed";
import { env } from "./env";
import { uploadImage } from "./http/upload";
import { logger } from "./lib/logger";
import { finalizeStaleRecordingSets } from "./library/recording-set";
import { appRouter } from "./rpc/app.router";
import type { AttachedWs } from "./session/session-manager";
import { SessionManager } from "./session/session-manager";
import { bindStageActions, startStageActions } from "./stage/stage-actions";
import {
  bindStagePublisher,
  stageFeedHooks,
  tryUpgradeStageFeed,
} from "./stage/stage-feed";
import type { StageFeedWsData } from "./stage/stage-feed";

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

// Orphan sweep: any frame_set still 'recording' at boot belongs to a run
// that died with the previous process — the registry is in-memory, so no
// live owner can exist. See finalizeStaleRecordingSets for why this is safe.
const sweptSets = await finalizeStaleRecordingSets(getDb());
if (sweptSets > 0) {
  logger.info(
    { sweptSets },
    "finalized orphaned recording sets from previous process"
  );
}

const port = env.PORT;

const app = new Hono();

// Shared singletons for the HTTP surface. The auth instance owns its own db
// pool (Better Auth + Dodo webhook); a second pool backs the oRPC context.
// createDb pools per connection string, so this is cheap.
const auth = getAuth();
const db = createDb(env.DATABASE_URL);
// Log unexpected RPC failures. oRPC otherwise swallows a thrown handler error
// into a generic 500 response with NO server-side trace, so silent
// "Internal server error" toasts were undebuggable. Expected typed errors
// (BAD_REQUEST / NOT_FOUND / CONFLICT … status < 500) are normal control flow
// and stay quiet; everything else (plain throws → INTERNAL_SERVER_ERROR) is
// logged with its stack.
const rpcHandler = new RPCHandler(appRouter, {
  clientInterceptors: [
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- oRPC interceptor lifecycle hook, not a node-style callback
    onError((error) => {
      const expected =
        error instanceof ORPCError &&
        typeof error.status === "number" &&
        error.status < 500;
      if (!expected) {
        logger.error(
          error instanceof Error ? error : { err: error },
          "rpc handler error"
        );
      }
    }),
  ],
});

// Live in-memory sessions. Created/destroyed by the WS lifecycle below, and
// also threaded into the HTTP context so the authed `control` router can find
// a user's own live session from a second device (the operator remote).
const manager = new SessionManager(logger);

// Crowd stage: fold audience intent (stage.tap / setKnob / submitPrompt RPCs)
// into the live Sessions — coalesced knob patches + the prompt dwell queue.
// Successor of the Monad event listener; always on (the RPCs are the
// transport now).
const stageActions = startStageActions({
  dwellMs: env.PROMPT_DWELL_MS,
  logger,
  registry: manager,
});
bindStageActions(stageActions);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/", (c) => c.text("sonara server — connect to /ws via WebSocket"));

// Better Auth owns every /api/auth/* path (sign-up, session, sign-out, and
// the Dodo webhook at /api/auth/dodopayments/webhook). Reached from the
// browser same-origin through the gateway, so cookies are first-party.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Image-anchor upload (multipart → fal storage).
app.post("/api/upload/image", (c) => uploadImage(c.req.raw));

// oRPC HTTP router (credits, mintWsTicket). Build the context per request
// from the Better Auth session, then delegate to the oRPC fetch handler.
// The caller IP (gateway-set X-Forwarded-For) rides along for the public
// crowd-stage throttles; null without a proxy (local dev).
app.all("/rpc/*", async (c) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const context = {
    ...buildContext({
      db,
      registry: manager,
      session: session
        ? { user: { email: session.user.email, id: session.user.id as UserId } }
        : null,
    }),
    ip,
  };
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
  // Durable stage this connection attaches to — resolved + ownership-checked
  // at ticket mint time (auth.router). Null for anon and for legacy tickets
  // minted by the previous build (≤5 min TTL window).
  stageId: string | null;
  role: WsRole;
  // Registry key this connection attaches under (see SessionManager): the
  // stage id, `anon:<anonId>`, or `conn:<wsId>` for legacy clients. Computed
  // once at upgrade so open/message/close agree.
  key: string;
}

// One Bun.serve handles two socket kinds: the oRPC session wire (/ws) and the
// public read-only stage feed (/ws/stage). The hooks below branch on `kind`.
type WsData = SessionWsData | StageFeedWsData;

const server = Bun.serve<WsData, never>({
  async fetch(req, srv) {
    const url = new URL(req.url);
    // Public per-room stage feed — no ticket; the room code is the capability
    // (same trust model as stage.snapshot). All logic lives in
    // stage/stage-feed.ts.
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
      // Registry keying. A client that sends ?liveSessionId= is a LEGACY
      // client (pre-stages web) — it gets verbatim per-socket semantics
      // (`conn:` key, finalize on close) so its sessionStorage identity and
      // multi-tab behavior stay byte-identical until the new web ships.
      // New clients never send it: authed ones key by the ticket's stage,
      // anon ones by their localStorage-stable anonStageId.
      const anonIdRaw = url.searchParams.get("anonStageId");
      const anonId =
        anonIdRaw && /^[A-Za-z0-9_-]{8,64}$/u.test(anonIdRaw)
          ? anonIdRaw
          : null;
      let key = `conn:${sessionId}`;
      if (liveSessionId === null) {
        if (payload.stageId) {
          key = payload.stageId;
        } else if (payload.userId === null && anonId) {
          key = `anon:${anonId}`;
        }
      }
      const upgraded = srv.upgrade(req, {
        data: {
          key,
          kind: "session" as const,
          liveSessionId,
          role: payload.role ?? "screen",
          sessionId,
          stageId: payload.stageId ?? null,
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
      const { key, sessionId } = ws.data;
      wsHandler.close(ws);
      manager.detach(key, ws as unknown as AttachedWs);
      logger.info({ key, sessionId }, "ws closed");
    },
    async message(ws, raw) {
      // Stage feed sockets are read-only — clients have nothing to say.
      if (ws.data.kind === "stage") {
        return;
      }
      const { key, sessionId } = ws.data;
      const session = manager.getByKey(key);
      if (!session) {
        logger.warn({ key, sessionId }, "message with no session");
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
      const { key, liveSessionId, sessionId, stageId, userId } = ws.data;
      const { resumed } = manager.attach({
        key,
        liveSessionId,
        stageId,
        userId,
        ws: ws as unknown as AttachedWs,
      });
      logger.info(
        { key, liveSessionId, resumed, sessionId, userId },
        "ws opened"
      );
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

// Railway sends SIGTERM on every deploy: drain the live sessions (abort
// in-flight jobs, finalize recordings) before exiting, so a mid-show promote
// doesn't strand frame_sets in 'recording'. Hard 5s cap — a hung pool must
// never block the deploy; whatever the drain misses, the boot sweep
// (finalizeStaleRecordingSets) finalizes on the next process.
const shutdown = (signal: string): void => {
  logger.info({ signal }, "shutting down — draining sessions");
  stageActions.close();
  void (async () => {
    await Promise.race([manager.closeAll(), Bun.sleep(5000)]);
    await server.stop();
    process.exit(0);
  })();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
