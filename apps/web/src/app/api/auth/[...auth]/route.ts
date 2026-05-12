import { getAuth } from "@/server/auth";

// Better Auth handles every /api/auth/* path — nonce, verify, session,
// signOut, etc. The [...auth] catch-all forwards the raw Request.

// Skip Next.js build-time page-data collection — sidesteps a
// Bun+Turbopack CJS-loader interop bug on catch-all server routes.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  return getAuth().handler(req);
}

export async function POST(req: Request): Promise<Response> {
  return getAuth().handler(req);
}
