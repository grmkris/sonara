import { ORPCError } from "@sonara/api/server";
import { signTicket } from "@sonara/shared";
import { env } from "@/env";
import { typeIdToUuid } from "@sonara/shared/typeid";
import { protectedProcedure } from "./procedures";

export const authRouter = {
  // Mint a short-lived HMAC ticket (5 min TTL) the client uses to upgrade
  // to the ws:// endpoint on apps/server. Payload carries the raw UUID so
  // the server can query Postgres without pulling in typeid-js.
  mintWsTicket: protectedProcedure.handler(async ({ context }) => {
    if (!env.BETTER_AUTH_SECRET) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: "BETTER_AUTH_SECRET not set",
      });
    }
    const { uuid } = typeIdToUuid(context.userId);
    const token = await signTicket({
      userId: uuid,
      secret: env.BETTER_AUTH_SECRET,
    });
    return { token };
  }),
};
