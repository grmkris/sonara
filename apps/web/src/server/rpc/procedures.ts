import { ORPCError, os } from "@music-visualizer/api/server";
import type { ApiContext } from "@music-visualizer/api/server";
import type { UserId } from "@music-visualizer/shared/typeid";
import type { Database } from "../db";

export type WebContext = ApiContext<Database>;

// Separate builder from packages/api so procedures here know the concrete DB
// type. Matches ai-stilist's pattern of defining procedure primitives per-app
// once the concrete context is known.
const o = os.$context<WebContext>();

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
