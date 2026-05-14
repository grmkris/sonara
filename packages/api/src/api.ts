import { ORPCError, os } from "@orpc/server";
import type { UserId } from "@sonara/shared/typeid";
import type { ApiContext } from "./context";

// Generic over the DB handle so the api package doesn't import drizzle
// schemas directly — apps supply the concrete Database type at mount time.
// Use `AppContext` below as the concrete shape the web app passes.
type AnyContext = ApiContext<unknown>;

const o = os.$context<AnyContext>();

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

export type { AnyContext };
