import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import { ClientScenePatch, DeckKeySchema } from "@sonara/shared";
import {
  LiveSessionIdSchema,
  typeIdFromUuid,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import type {
  FrameSetId,
  LiveSessionId,
  UserId,
} from "@sonara/shared/typeid";
import { eq } from "drizzle-orm";
import { isAddress } from "viem";
import { z } from "zod";

import { stageFaucet } from "../onchain/stage-faucet";
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
        currentFrameUrl: snap.currentFrameUrl,
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
      const session = resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      );
      const room = stageRooms.open(input.liveSessionId, input.allowPrompts);
      // Tell the projector so it can mount its wire overlay + dial /ws/stage.
      // The join QR starts shown so the room can fill straight away.
      session.notifyStage(room, input.allowPrompts, true);
      return { allowPrompts: input.allowPrompts, room, showQr: true };
    }),

  // Toggle the projector's join-QR overlay (the audience scans the big
  // screen, not the host's phone). Rides the same stage.status push.
  setStageQr: protectedProcedure
    .input(ByLiveSession.extend({ show: z.boolean() }))
    .handler(({ context, input }) => {
      const session = resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      );
      const status = stageRooms.statusFor(input.liveSessionId);
      if (!status) {
        throw new ORPCError("NOT_FOUND", {
          message: "No open stage for that session.",
        });
      }
      stageRooms.setShowQr(status.room, input.show);
      session.notifyStage(status.room, status.allowPrompts, input.show);
      return { showQr: input.show };
    }),

  closeStage: protectedProcedure
    .input(ByLiveSession)
    .handler(({ context, input }) => {
      const session = resolveOwnedSession(
        context.registry,
        context.userId,
        input.liveSessionId
      );
      const room = stageRooms.roomFor(input.liveSessionId);
      if (room) {
        stageRooms.close(room);
      }
      session.notifyStage(null);
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

  // Public: top an audience smart account up with USDC so it can prompt
  // without leaving the show. An open room code is the capability; the faucet
  // itself enforces the per-wallet cooldown + "can't already afford a prompt"
  // rule and reports failures as data (the UI toasts the reason).
  stageAirdrop: publicProcedure
    .input(z.object({ address: z.string(), room: z.string() }))
    .handler(({ input }) => {
      if (!stageRooms.resolve(input.room)) {
        throw new ORPCError("NOT_FOUND", { message: "stage is not open" });
      }
      if (!isAddress(input.address)) {
        throw new ORPCError("BAD_REQUEST", { message: "bad wallet address" });
      }
      return stageFaucet.drip(input.address);
    }),

  // Public: the /s/[id] permalink resolver. Accepts a set_ id (a recording's
  // set uuid = its lse uuid, so the link exists from the first frame) or a
  // bare lse_ id (anon producers have no recording set — live tense only).
  //
  // Tense rules: a registry hit on the set's liveSessionId → LIVE — readable
  // by anyone holding the id (the link is the capability, same trust model as
  // a stage room code). No registry hit → REPLAY — honors set visibility
  // (owner always; others need non-private). Missing and private-to-others
  // both come back exists:false so a private set's existence doesn't leak.
  // Replay frames are NOT inlined — the page fetches sets.get (same gate).
  lens: publicProcedure
    .input(z.object({ id: z.string().min(8).max(64) }))
    .handler(async ({ context, input }) => {
      let setRow: {
        frameCount: number;
        id: FrameSetId;
        liveSessionId: LiveSessionId | null;
        name: string;
        origin: "builtin" | "recording" | "curated";
        status: "recording" | "final";
        userId: UserId | null;
        visibility: "private" | "unlisted" | "public";
      } | null = null;
      let liveSessionId: string | null = null;

      // A prefix-valid but undecodable suffix makes typeIdToUuid throw (both
      // directly and inside drizzle's typeId toDriver) — on a public endpoint
      // that must read as "not found", never a 500.
      try {
        typeIdToUuid(input.id as FrameSetId);
      } catch {
        return { exists: false as const };
      }

      if (input.id.startsWith("set_")) {
        const [row] = await context.db
          .select({
            frameCount: SCHEMA.frameSet.frameCount,
            id: SCHEMA.frameSet.id,
            liveSessionId: SCHEMA.frameSet.liveSessionId,
            name: SCHEMA.frameSet.name,
            origin: SCHEMA.frameSet.origin,
            status: SCHEMA.frameSet.status,
            userId: SCHEMA.frameSet.userId,
            visibility: SCHEMA.frameSet.visibility,
          })
          .from(SCHEMA.frameSet)
          .where(eq(SCHEMA.frameSet.id, input.id as FrameSetId))
          .limit(1);
        if (row) {
          setRow = row;
          ({ liveSessionId } = row);
        } else {
          // No row yet — recording sets only materialize on the first
          // PERSISTED frame, but a deck-only session shows frames without
          // ever persisting. The set uuid IS the lse uuid by construction,
          // so derive it and let the registry decide: live → watchable now,
          // row appears later if the show generates; not live → not found.
          liveSessionId = typeIdFromUuid(
            "liveSession",
            typeIdToUuid(input.id as FrameSetId).uuid
          );
        }
      } else if (input.id.startsWith("lse_")) {
        liveSessionId = input.id;
      } else {
        return { exists: false as const };
      }

      const callerId = (context.session?.user.id as UserId | undefined) ?? null;
      const set = setRow
        ? {
            frameCount: setRow.frameCount,
            id: setRow.id,
            name: setRow.name,
            origin: setRow.origin,
            status: setRow.status,
            visibility: setRow.visibility,
          }
        : null;

      const session = liveSessionId
        ? context.registry.getByLiveSessionId(liveSessionId)
        : undefined;
      if (session) {
        const snap = session.getControlSnapshot();
        const isOwner =
          callerId !== null && session.userId === typeIdToUuid(callerId).uuid;
        const room = stageRooms.roomFor(liveSessionId as string);
        const binding = room ? stageRooms.resolve(room) : undefined;
        return {
          exists: true as const,
          isOwner,
          live: {
            currentFrameUrl: snap.currentFrameUrl,
            currentSource: snap.currentSource,
            jobStatus: snap.jobStatus,
            liveSessionId: snap.liveSessionId,
            nowPlaying: snap.nowPlaying,
          },
          set,
          stage: room
            ? {
                ...stageState.get(room),
                allowPrompts: binding?.allowPrompts ?? false,
                open: true,
                room,
              }
            : null,
          tense: "live" as const,
        };
      }

      if (!setRow) {
        return { exists: false as const };
      }
      const isOwner = callerId !== null && setRow.userId === callerId;
      if (setRow.visibility === "private" && !isOwner) {
        return { exists: false as const };
      }
      return {
        exists: true as const,
        isOwner,
        live: null,
        set,
        stage: null,
        tense: "replay" as const,
      };
    }),
};
