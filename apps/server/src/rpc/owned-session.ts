import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";

// Resolve the live Session for `liveSessionId` and assert the caller owns it.
// ctx.userId is the user's typeid (usr_…) but Session.userId is the raw UUID
// (the WS ticket converts it — see auth.router mintWsTicket), so we convert
// before comparing. Unknown id → NOT_FOUND; someone else's session → FORBIDDEN.
export const resolveOwnedSession = (
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
