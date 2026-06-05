import type { RouterClient } from "@orpc/server";
import { authRouter } from "./auth.router";
import { controlRouter } from "./control.router";
import { creditsRouter } from "./credits.router";
import { libraryRouter } from "./library.router";
import { publicProcedure } from "./procedures";

// The HTTP (oRPC over fetch) router. Mounted by the server's Hono app at
// /rpc and reached from the browser through the Caddy gateway (same-origin).
// The web app imports only the *type* (AppRouterClient) via the `server/rpc`
// package export — `import type` is erased at compile time, so none of the
// server runtime deps (db, dodopayments, fal) leak into the web bundle.
export const appRouter = {
  healthCheck: publicProcedure.handler(() => "OK" as const),
  auth: authRouter,
  credits: creditsRouter,
  library: libraryRouter,
  control: controlRouter,
};

export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
