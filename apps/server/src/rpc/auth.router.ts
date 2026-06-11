import { ORPCError } from "@sonara/api/server";
import { signTicket } from "@sonara/shared";
import { StageIdSchema, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { z } from "zod";

import { env } from "../env";
import { getOwnedStage, resolveDefaultStage } from "../stage/stage-service";
import { publicProcedure } from "./procedures";

export const authRouter = {
  // Mint a short-lived HMAC ticket (5 min TTL) the client uses to upgrade
  // to the ws:// endpoint on this server. Signed-in users get their raw
  // UUID plus the resolved stage (their default, or an owned stage passed
  // explicitly — ownership checked HERE so the WS upgrade never needs the
  // DB). Unauthenticated visitors get null userId/stageId — the server then
  // pins that session to demo-library mode (no fal, no credit debit, no
  // AudD). Public on purpose so the marketing visitor can experience the
  // visualiser without an account.
  //
  // Minting an authed ticket lazily creates the account's default stage
  // ("Your stage") — only /play-style screen attaches mint tickets, so this
  // is exactly the "first screen attach" moment.
  mintWsTicket: publicProcedure
    .input(z.object({ stageId: StageIdSchema.optional() }).optional())
    .handler(async ({ context, input }) => {
      if (!env.BETTER_AUTH_SECRET) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "BETTER_AUTH_SECRET not set",
        });
      }
      const sessionUserId = context.session
        ? (context.session.user.id as UserId)
        : null;
      let stage = null;
      if (sessionUserId) {
        stage = input?.stageId
          ? await getOwnedStage(context.db, sessionUserId, input.stageId)
          : await resolveDefaultStage(context.db, sessionUserId);
      }
      const token = await signTicket({
        role: "screen",
        secret: env.BETTER_AUTH_SECRET,
        stageId: stage?.id ?? null,
        userId: sessionUserId ? typeIdToUuid(sessionUserId).uuid : null,
      });
      return { token };
    }),
};
