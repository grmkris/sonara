import { ORPCError } from "@sonara/api/server";
import { signTicket } from "@sonara/shared";
import { typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";

import { env } from "../env";
import { publicProcedure } from "./procedures";

export const authRouter = {
  // Mint a short-lived HMAC ticket (5 min TTL) the client uses to upgrade
  // to the ws:// endpoint on this server. Signed-in users get their raw
  // UUID in the payload; unauthenticated visitors get a null userId —
  // the server then pins that session to demo-library mode (no fal, no
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
      secret: env.BETTER_AUTH_SECRET,
      userId,
    });
    return { token };
  }),
};
