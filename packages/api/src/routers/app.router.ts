// Placeholder "smoke" router kept for packages/api consumers who want a
// ready-made minimal router (e.g. in tests). Real app routers live in
// apps/web/src/server/rpc/ where they have access to the local schema.
import type { RouterClient } from "@orpc/server";

import { publicProcedure } from "../api";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
