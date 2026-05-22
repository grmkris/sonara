import { ORPCError, os } from "@sonara/api/server";
import type { ApiContext } from "@sonara/api/server";
import type { UserId } from "@sonara/shared/typeid";
import type { Database } from "@sonara/db";

export type ServerHttpContext = ApiContext<Database>;

// Procedure primitives for the HTTP (oRPC over fetch) surface, bound to the
// concrete server DB type. The realtime WebSocket surface uses its own
// SessionContext primitives in packages/api — these are only for the
// request/response routers (auth ticket, credits).
const o = os.$context<ServerHttpContext>();

export const publicProcedure = o;

const requireAuth = o.middleware(({ context, next }) => {
  if (!context.session) {
    throw new ORPCError("UNAUTHORIZED");
  }
  return next({
    context: {
      ...context,
      session: context.session,
      userId: context.session.user.id as UserId,
    },
  });
});

export const protectedProcedure = publicProcedure.use(requireAuth);
