// Short-lived HMAC-signed tickets for authorizing WebSocket upgrades.
// Shared between apps/web (mints after Better Auth session check) and
// apps/server (verifies on ws.upgrade). No DB or dependency on Better Auth
// from the server — server only needs the shared secret.
//
// Wire shape: `base64url(headerJson).base64url(payloadJson).base64url(sig)`
// where sig = HMAC-SHA256(secret, `${headerJson}.${payloadJson}`).
// Deliberately NOT a JWT — no alg=none footgun, no library required.

export interface WsTicketPayload {
  // raw UUID for authenticated users; null for anonymous demo sessions.
  // Server uses non-null as-is in pg queries; null means "skip credits + fal,
  // demo library only" (see apps/server/src/session/session.ts).
  userId: string | null;
  exp: number; // epoch ms
  iat: number; // epoch ms
}

const HEADER = { alg: "HS256", typ: "ws-ticket" } as const;
const HEADER_B64 = base64UrlEncode(
  new TextEncoder().encode(JSON.stringify(HEADER))
);
const TEXT = new TextEncoder();

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCharCode(b);
  }
  return btoa(bin)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function base64UrlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    TEXT.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );
}

async function hmac(secret: string, data: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
}

export interface SignTicketArgs {
  userId: string | null;
  secret: string;
  ttlMs?: number; // default 5 minutes
}

export async function signTicket({
  userId,
  secret,
  ttlMs = 5 * 60 * 1000,
}: SignTicketArgs): Promise<string> {
  const now = Date.now();
  const payload: WsTicketPayload = { exp: now + ttlMs, iat: now, userId };
  const payloadB64 = base64UrlEncode(TEXT.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, `${HEADER_B64}.${payloadB64}`);
  return `${HEADER_B64}.${payloadB64}.${sig}`;
}

// Constant-time string compare to avoid timing-oracle leaks.
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyTicket(
  token: string,
  secret: string
): Promise<WsTicketPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [headerB64, payloadB64, sig] = parts as [string, string, string];
  if (headerB64 !== HEADER_B64) {
    return null;
  }
  const expectedSig = await hmac(secret, `${headerB64}.${payloadB64}`);
  if (!constantTimeEqual(sig, expectedSig)) {
    return null;
  }
  let payload: WsTicketPayload;
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payloadB64));
    payload = JSON.parse(json) as WsTicketPayload;
  } catch {
    return null;
  }
  const userIdOk =
    typeof payload.userId === "string" || payload.userId === null;
  if (
    !userIdOk ||
    typeof payload.exp !== "number" ||
    Date.now() > payload.exp
  ) {
    return null;
  }
  return payload;
}
