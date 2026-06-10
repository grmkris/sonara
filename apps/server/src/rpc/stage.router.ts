import { ORPCError } from "@sonara/api/server";
import { LiveSessionIdSchema, StageIdSchema } from "@sonara/shared/typeid";
import { isAddress } from "viem";
import { z } from "zod";

import { stageFaucet } from "../onchain/stage-faucet";
import { stageRooms } from "../onchain/stage-rooms";
import { stageState } from "../onchain/stage-state";
import { getOwnedStage } from "../stage/stage-service";
import { resolveOwnedSession } from "./owned-session";
import { resolveOwnedStageRun } from "./owned-stage";
import { protectedProcedure, publicProcedure } from "./procedures";

// Monad "stage": let the crowd (and AI agents) drive a session over on-chain
// txs. Dual-keyed during the stages rollout:
//
//   { stageId }        crowd access opens under the stage row's PERMANENT
//                      code (printable QR; survives reconnects, redeploy-
//                      minted runs, and "new set"). Requires the stage to be
//                      live (a screen attached its run) so the projector can
//                      mount the wire overlay.
//   { liveSessionId }  legacy clients: per-gig minted code bound to the run.
//                      Deleted in the post-W2 cleanup.
//
// Reading live state stays public — the room code IS the capability the
// audience page already holds.

const ByLiveSession = z.object({ liveSessionId: LiveSessionIdSchema });
const ByTarget = z.union([z.object({ stageId: StageIdSchema }), ByLiveSession]);

export const stageRouter = {
  // Public: top an audience smart account up with USDC so it can prompt
  // without leaving the show. An open room code is the capability; the faucet
  // itself enforces the per-wallet cooldown + "can't already afford a prompt"
  // rule and reports failures as data (the UI toasts the reason).
  airdrop: publicProcedure
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

  close: protectedProcedure
    .input(ByTarget)
    .handler(async ({ context, input }) => {
      if ("stageId" in input) {
        // Ownership only — closing crowd access must work even if the run
        // already ended (grace expiry); notify the screen only when live.
        await getOwnedStage(context.db, context.userId, input.stageId);
        const room = stageRooms.roomForStage(input.stageId);
        if (room) {
          stageRooms.close(room);
        }
        context.registry.getByStageId(input.stageId)?.notifyStage(null);
        return;
      }
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

  open: protectedProcedure
    .input(ByTarget.and(z.object({ allowPrompts: z.boolean().default(true) })))
    .handler(async ({ context, input }) => {
      if ("stageId" in input) {
        // The stage must be live — the crowd drives a running show, and the
        // projector has to mount its wire overlay.
        const session = await resolveOwnedStageRun(
          { db: context.db, registry: context.registry },
          context.userId,
          input.stageId
        );
        const stage = await getOwnedStage(
          context.db,
          context.userId,
          input.stageId
        );
        stageRooms.openForStage(stage.code, stage.id, input.allowPrompts);
        session.notifyStage(stage.code, input.allowPrompts, true);
        return { allowPrompts: input.allowPrompts, room: stage.code, showQr: true };
      }
      // LEGACY: assert ownership before exposing the session to the crowd.
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
  setQr: protectedProcedure
    .input(ByTarget.and(z.object({ show: z.boolean() })))
    .handler(async ({ context, input }) => {
      if ("stageId" in input) {
        const session = await resolveOwnedStageRun(
          { db: context.db, registry: context.registry },
          context.userId,
          input.stageId
        );
        const status = stageRooms.statusForStage(input.stageId);
        if (!status) {
          throw new ORPCError("NOT_FOUND", {
            message: "This stage isn't open to the crowd.",
          });
        }
        stageRooms.setShowQr(status.room, input.show);
        session.notifyStage(status.room, status.allowPrompts, input.show);
        return { showQr: input.show };
      }
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

  // Public: the projector overlay + audience page poll this for the live tx
  // counter and the prompt queue (now-playing / up-next). Unknown room → empty.
  snapshot: publicProcedure
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
