import { publicProcedure } from "../api";

export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
};

export type AppRouter = typeof appRouter;
