import type { UserId } from "@sonara/shared/typeid";

// Mirrors @sonara/api's ApiContext<TDb> shape without depending on it — the
// test file casts the result to its app's concrete context type (e.g.
// ServerHttpContext) so test-utils never imports apps/server.
export interface TestServerCtx<TDb, TRegistry> {
  db: TDb;
  registry: TRegistry;
  session: { user: { email?: string; id: UserId } } | null;
  userId: UserId | null;
}

export const makeServerCtx = <TDb, TRegistry = Record<string, never>>(args: {
  db: TDb;
  email?: string;
  registry?: TRegistry;
  userId?: UserId | null;
}): TestServerCtx<TDb, TRegistry> => ({
  db: args.db,
  registry: (args.registry ?? {}) as TRegistry,
  session: args.userId
    ? { user: { email: args.email, id: args.userId } }
    : null,
  userId: args.userId ?? null,
});
