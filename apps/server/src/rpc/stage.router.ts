import { ORPCError } from "@sonara/api/server";
import { LiveSessionIdSchema } from "@sonara/shared/typeid";
import { isAddress } from "viem";
import { z } from "zod";

import { stageFaucet } from "../onchain/stage-faucet";
import { stageRooms } from "../onchain/stage-rooms";
import { stageState } from "../onchain/stage-state";
import { resolveOwnedSession } from "./owned-session";
import { protectedProcedure, publicProcedure } from "./procedures";

// Monad "stage": let the crowd (and AI agents) drive a session over on-chain
// txs. The owner opens a stage to mint a short room code; anyone with the
// code emits SonaraStage events that the listener folds in. Opening requires
// owning the session; reading the live state does not (the room code is the
// capability the audience page already holds).

const ByLiveSession = z.object({ liveSessionId: LiveSessionIdSchema });

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

  open: protectedProcedure
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
  setQr: protectedProcedure
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
