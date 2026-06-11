import { ORPCError } from "@sonara/api/server";
import { MAX_STAGE_PROMPT_CHARS, StageKnobName } from "@sonara/shared";
import { LiveSessionIdSchema, StageIdSchema } from "@sonara/shared/typeid";
import { z } from "zod";

import { stageActions } from "../onchain/stage-actions";
import { publishActivity } from "../onchain/stage-feed";
import { stageRooms } from "../onchain/stage-rooms";
import { stageState } from "../onchain/stage-state";
import { stageThrottle } from "../onchain/stage-throttle";
import { getOwnedStage } from "../stage/stage-service";
import { resolveOwnedSession } from "./owned-session";
import { resolveOwnedStageRun } from "./owned-stage";
import { protectedProcedure, publicProcedure } from "./procedures";

// Crowd "stage": let the audience drive a session from their phones. Crowd
// writes (tap / setKnob / submitPrompt) are public — the room code IS the
// capability, same trust model as snapshot — throttled per caller, and
// charged to nobody but the stage owner: generation that a crowd prompt
// triggers debits the owner's credits exactly like an operator prompt. The
// dwell queue (one prompt plays per PROMPT_DWELL_MS per room) and the 200ms
// knob flush bound that spend.
//
// Host control is dual-keyed during the stages rollout:
//
//   { stageId }        crowd access opens under the stage row's PERMANENT
//                      code (printable QR; survives reconnects, redeploy-
//                      minted runs, and "new set"). Requires the stage to be
//                      live (a screen attached its run) so the projector can
//                      mount the wire overlay.
//   { liveSessionId }  legacy clients: per-gig minted code bound to the run.
//                      Deleted in the post-W2 cleanup.

const ByLiveSession = z.object({ liveSessionId: LiveSessionIdSchema });
const ByTarget = z.union([z.object({ stageId: StageIdSchema }), ByLiveSession]);

// Opaque per-device handle the crowd page generates (e.g. K7QX). Display +
// queue identity only — never an account.
const From = z
  .string()
  .trim()
  .max(12)
  .regex(/^[\w-]*$/u)
  .default("anon");

const requireRoom = (room: string) => {
  const binding = stageRooms.resolve(room);
  if (!binding) {
    throw new ORPCError("NOT_FOUND", { message: "stage is not open" });
  }
  return binding;
};

const requireActions = () => {
  const actions = stageActions();
  if (!actions) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "stage actions not ready",
    });
  }
  return actions;
};

const throttleOr429 = (
  kind: "tap" | "prompt",
  room: string,
  ip: string | null,
  from: string
): void => {
  if (!stageThrottle.allow(kind, room, ip ?? from)) {
    throw new ORPCError("TOO_MANY_REQUESTS", {
      message: "easy — try again in a moment",
    });
  }
};

export const stageRouter = {
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

  // Public crowd write: an absolute knob level (slider release). Supersedes
  // pending taps on the same knob within the flush window.
  setKnob: publicProcedure
    .input(
      z.object({
        from: From,
        knob: StageKnobName,
        level: z.number().min(0).max(1),
        room: z.string(),
      })
    )
    .handler(({ context, input }) => {
      requireRoom(input.room);
      throttleOr429("tap", input.room, context.ip, input.from);
      if (!requireActions().applySet(input.room, input.knob, input.level)) {
        throw new ORPCError("NOT_FOUND", { message: "stage is not live" });
      }
      stageState.bump(input.room);
      publishActivity(input.room, {
        kind: "set",
        knob: input.knob,
        value: input.level,
        who: input.from,
      });
      return { ok: true };
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

  // Public: the projector overlay + audience page poll this for the live
  // activity counter and the prompt queue (now-playing / up-next). Unknown
  // room → empty.
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

  // Public crowd write: queue a prompt for the projector. Gated on the host's
  // allowPrompts toggle; the dwell queue rotates submissions so everyone gets
  // a turn. Returns queued=false when the queue rejected it (duplicate text).
  submitPrompt: publicProcedure
    .input(
      z.object({
        from: From,
        room: z.string(),
        text: z.string().trim().min(1).max(MAX_STAGE_PROMPT_CHARS),
      })
    )
    .handler(({ context, input }) => {
      const binding = requireRoom(input.room);
      if (!binding.allowPrompts) {
        throw new ORPCError("FORBIDDEN", {
          message: "prompts are off for this stage",
        });
      }
      throttleOr429("prompt", input.room, context.ip, input.from);
      const queued = requireActions().enqueuePrompt(
        input.room,
        input.text,
        input.from
      );
      if (queued) {
        stageState.bump(input.room);
        publishActivity(input.room, {
          kind: "prompt",
          text: input.text,
          who: input.from,
        });
      }
      return { queued };
    }),

  // Public crowd write: a relative knob tap. Coalesced server-side (200ms
  // flush) into one scene patch per room.
  tap: publicProcedure
    .input(
      z.object({
        delta: z.number().min(-1).max(1),
        from: From,
        knob: StageKnobName,
        room: z.string(),
      })
    )
    .handler(({ context, input }) => {
      requireRoom(input.room);
      throttleOr429("tap", input.room, context.ip, input.from);
      if (!requireActions().applyTap(input.room, input.knob, input.delta)) {
        throw new ORPCError("NOT_FOUND", { message: "stage is not live" });
      }
      stageState.bump(input.room);
      publishActivity(input.room, {
        delta: input.delta,
        kind: "nudge",
        knob: input.knob,
        who: input.from,
      });
      return { ok: true };
    }),
};
