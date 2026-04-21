import type { RouterClient } from "@orpc/server";
import { authRouter } from "./auth.router";
import { creditsRouter } from "./credits.router";
import { publicProcedure } from "./procedures";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
  auth: authRouter,
  credits: creditsRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
