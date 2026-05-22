import { ORPCError } from "@sonara/api/server";
import { signTicket } from "@sonara/shared";
import { env } from "@/env";
import { typeIdToUuid, type UserId } from "@sonara/shared/typeid";
import { publicProcedure } from "./procedures";

export const authRouter = {
  // Mint a short-lived HMAC ticket (5 min TTL) the client uses to upgrade
  // to the ws:// endpoint on apps/server. Signed-in users get their raw
  // UUID in the payload; unauthenticated visitors get a null userId —
  // apps/server then pins that session to demo-library mode (no fal, no
  // credit debit, no AudD). Public on purpose so the marketing visitor can
  // experience the visualiser without an account.
  mintWsTicket: publicProcedure.handler(async ({ context }) => {
    if (!env.BETTER_AUTH_SECRET) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "BETTER_AUTH_SECRET not set",
      });
    }
    const userId = context.session
      ? typeIdToUuid(context.session.user.id as UserId).uuid
      : null;
    const token = await signTicket({
      userId,
      secret: env.BETTER_AUTH_SECRET,
    });
    return { token };
  }),
};
