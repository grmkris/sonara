import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { ClientScenePatch, DeckKeySchema } from "@sonara/shared";
import { LiveSessionIdSchema, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { z } from "zod";

import { stageRooms } from "../onchain/stage-rooms";
import { stageState } from "../onchain/stage-state";
import { protectedProcedure, publicProcedure } from "./procedures";

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
  registry: {
    getByLiveSessionId: (id: string) => ControllableSession | undefined;
  },
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

// oxlint-disable-next-line sort-keys -- REVIEW: the Monad "stage" procedures are grouped together at the end rather than interleaved alphabetically with the original operator ops
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

  // --- Monad "stage": let the crowd (and AI agents) drive this session over
  // on-chain txs. The owner opens a stage to mint a short room code; anyone
  // with the code emits SonaraStage events that the listener folds in. Opening
  // requires owning the session; reading the live state does not (the room
  // code is the capability the audience page already holds).

  openStage: protectedProcedure
    .input(ByLiveSession.extend({ allowPrompts: z.boolean().default(true) }))
    .handler(({ context, input }) => {
      // Assert ownership before exposing the session to the crowd.
      resolveOwnedSession(context.registry, context.userId, input.liveSessionId);
      const room = stageRooms.open(input.liveSessionId, input.allowPrompts);
      return { allowPrompts: input.allowPrompts, room };
    }),

  closeStage: protectedProcedure
    .input(ByLiveSession)
    .handler(({ context, input }) => {
      resolveOwnedSession(context.registry, context.userId, input.liveSessionId);
      const room = stageRooms.roomFor(input.liveSessionId);
      if (room) {
        stageRooms.close(room);
      }
    }),

  // Public: the projector overlay + audience page poll this for the live tx
  // counter and the prompt queue (now-playing / up-next). Unknown room → empty.
  stageSnapshot: publicProcedure
    .input(z.object({ room: z.string() }))
    .handler(({ input }) => {
      const binding = stageRooms.resolve(input.room);
      return {
        ...stageState.get(input.room),
        allowPrompts: binding?.allowPrompts ?? false,
        open: Boolean(binding),
      };
    }),
};
