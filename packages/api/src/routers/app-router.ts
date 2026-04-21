import type { RouterClient } from "@orpc/server";
import { publicProcedure } from "../api";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
