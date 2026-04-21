import type { RouterClient } from "@orpc/server";
import { creditsRouter } from "./credits.router";
import { publicProcedure } from "./procedures";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
  credits: creditsRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
