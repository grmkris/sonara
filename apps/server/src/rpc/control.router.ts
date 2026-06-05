import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { ClientScenePatch, DeckKeySchema } from "@sonara/shared";
import { LiveSessionIdSchema, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { z } from "zod";

import { protectedProcedure } from "./procedures";

// Operator remote control plane. A signed-in user drives ONE OF THEIR OWN
// currently-live in-memory Sessions from a second device (apps/web /control)
// while the Display (the projector machine) keeps owning the WebSocket. Every
// mutation here calls the same Session methods the WS session.router calls, so
// the Display's canvas + HUD update for free over its existing socket
// (scene.state / frame.* events). This router only writes + reads snapshots.
//
// Discovery is account-linked: the ephemeral per-tab WS id (and thus the
// liveSessionId) churns on every reconnect, so the operator never pins an id —
// it re-resolves "my live session" from liveSessions() each poll.

const ByLiveSession = z.object({ liveSessionId: LiveSessionIdSchema });

const ScenePatchInput = ByLiveSession.extend({ patch: ClientScenePatch });
const GoLiveInput = ByLiveSession.extend({ prompt: z.string() });
const SetDemoModeInput = ByLiveSession.extend({
  deck: DeckKeySchema.nullable(),
  on: z.boolean(),
});
const SetImageAnchorInput = z.union([
  ByLiveSession.extend({
    strength: z.number().min(0).max(1),
    url: z.string().url(),
  }),
  ByLiveSession.extend({ clear: z.literal(true) }),
]);

// Resolve the live Session for `liveSessionId` and assert the caller owns it.
// ctx.userId is the user's typeid (usr_…) but Session.userId is the raw UUID
// (the WS ticket converts it — see auth.router mintWsTicket), so we convert
// before comparing. Unknown id → NOT_FOUND; someone else's session → FORBIDDEN.
const resolveOwnedSession = (
  registry: { getByLiveSessionId(id: string): ControllableSession | undefined },
  userId: UserId,
  liveSessionId: string
): ControllableSession => {
  const session = registry.getByLiveSessionId(liveSessionId);
  if (!session) {
    throw new ORPCError("NOT_FOUND", {
      message: "That session isn't live (it may have disconnected).",
    });
  }
  const rawUuid = typeIdToUuid(userId).uuid;
  if (session.userId !== rawUuid) {
    throw new ORPCError("FORBIDDEN");
  }
  return session;
};

export const controlRouter = {
  // The operator has no canvas, so there's no on-screen deck frame to hand off
  // from — seed from the server's last final frame if there is one, else start
  // text-only.
  goLive: protectedProcedure
    .input(GoLiveInput)
    .handler(({ context, input }) => {
      const session = resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      );
      session.goLive(input.prompt, session.getControlSnapshot().lastFrameUrl);
    }),

  // The caller's currently-live sessions (usually one — the projector). The
  // operator UI lists these to pick / auto-select, and re-resolves on every
  // poll so it follows a reconnect that minted a fresh liveSessionId.
  liveSessions: protectedProcedure.handler(({ context }) => {
    const rawUuid = typeIdToUuid(context.userId).uuid;
    const sessions = context.registry.listByUserId(rawUuid).map((s) => {
      const snap = s.getControlSnapshot();
      return {
        demoDeck: snap.demoDeck,
        demoMode: snap.demoMode,
        jobStatus: snap.jobStatus,
        lastFrameUrl: snap.lastFrameUrl,
        liveSessionId: snap.liveSessionId,
        nowPlaying: snap.nowPlaying,
        prompt: snap.scene.prompt,
        startedAt: snap.startedAt,
      };
    });
    // Newest session first so the projector you just opened leads the list.
    sessions.sort((a, b) => b.startedAt - a.startedAt);
    return { sessions };
  }),

  reset: protectedProcedure
    .input(ByLiveSession)
    .handler(({ context, input }) => {
      resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      ).reset();
    }),

  scenePatch: protectedProcedure
    .input(ScenePatchInput)
    .handler(({ context, input }) => {
      resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      ).applyPatch(input.patch, "client");
    }),

  setDemoMode: protectedProcedure
    .input(SetDemoModeInput)
    .handler(({ context, input }) => {
      resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      ).setDemoMode(input.on, input.deck);
    }),

  setImageAnchor: protectedProcedure
    .input(SetImageAnchorInput)
    .handler(({ context, input }) => {
      const session = resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      );
      session.setImageAnchor(
        "clear" in input
          ? { clear: true }
          : { strength: input.strength, url: input.url }
      );
    }),

  // Full snapshot of one owned live session. Polled (~1s) by the operator UI to
  // hydrate the same zustand store the WS path feeds — current scene, status,
  // and the last frame URL for the thumbnail.
  snapshot: protectedProcedure
    .input(ByLiveSession)
    .handler(({ context, input }) =>
      resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      ).getControlSnapshot()
    ),
};
