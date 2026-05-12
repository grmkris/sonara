import { buildContext, RPCHandler } from "@music-visualizer/api/server";
import type { UserId } from "@music-visualizer/shared/typeid";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { createDb } from "@music-visualizer/db";
import { appRouter } from "@/server/rpc/app-router";

const handler = new RPCHandler(appRouter);

async function handle(request: Request): Promise<Response> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });

  const db = createDb(env.DATABASE_URL);

  const context = buildContext({
    db,
    session: session
      ? { user: { id: session.user.id as UserId } }
      : null,
  });

  const { matched, response } = await handler.handle(request, {
    prefix: "/rpc",
    context,
  });
  if (matched) return response;
  return new Response("Not found", { status: 404 });
}

export { handle as GET, handle as POST };
