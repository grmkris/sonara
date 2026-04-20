import { getAuth } from "@/server/auth";

// Better Auth handles every /api/auth/* path — nonce, verify, session,
// signOut, etc. The [...auth] catch-all forwards the raw Request.

export async function GET(req: Request): Promise<Response> {
  return getAuth().handler(req);
}

export async function POST(req: Request): Promise<Response> {
  return getAuth().handler(req);
}
