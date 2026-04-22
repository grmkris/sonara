import { NextResponse } from "next/server";
import { signTicket } from "@music-visualizer/shared";
import { env } from "@/env";
import { getAuth } from "@/server/auth";
import { typeIdToUuid } from "@/lib/typeid";

// Mints a short-lived (default 5 min) HMAC-signed ticket for WebSocket
// upgrades. Client fetches this after SIWE sign-in, then opens the WS with
// `?token=<ticket>`. apps/server verifies the HMAC and stashes userId on
// ws.data — no DB round-trip, no shared Better Auth instance required.

export async function POST(req: Request): Promise<Response> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.session) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  // Ticket payload carries the raw UUID so apps/server can pass it straight
  // to Postgres without needing typeid-js on the server.
  const { uuid } = typeIdToUuid(session.user.id as `usr_${string}`);
  const token = await signTicket({
    userId: uuid,
    secret: env.BETTER_AUTH_SECRET,
  });
  return NextResponse.json({ token });
}
