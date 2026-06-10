// Short-lived HMAC-signed tickets for authorizing WebSocket upgrades.
// Shared between apps/web (mints after Better Auth session check) and
// apps/server (verifies on ws.upgrade). No DB or dependency on Better Auth
// from the server — server only needs the shared secret.
//
// Wire shape: `base64url(headerJson).base64url(payloadJson).base64url(sig)`
// where sig = HMAC-SHA256(secret, `${headerJson}.${payloadJson}`).
// Deliberately NOT a JWT — no alg=none footgun, no library required.

// Connection roles. Only the screen (projector/producer) exists today;
// operator/watcher arrive with the rooms phases.
export type WsRole = "screen";

export interface WsTicketPayload {
  // raw UUID for authenticated users; null for anonymous demo sessions.
  // Server uses non-null as-is in pg queries; null means "skip credits + fal,
  // demo library only" (see apps/server/src/session/session.ts).
  userId: string | null;
  // stg_ typeid of the stage this connection attaches to, resolved and
  // ownership-checked at mint time (auth.router mintWsTicket). Null for anon.
  // Optional on verify: tickets minted by the previous build (≤5 min TTL)
  // predate the field.
  stageId?: string | null;
  role?: WsRole;
  // epoch ms
  exp: number;
  // epoch ms
  iat: number;
}

const base64UrlEncode = (bytes: Uint8Array): string => {
  let bin = "";
  for (const b of bytes) {
    bin += String.fromCodePoint(b);
  }
  return btoa(bin)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

const HEADER = { alg: "HS256", typ: "ws-ticket" } as const;
const HEADER_B64 = base64UrlEncode(
  new TextEncoder().encode(JSON.stringify(HEADER))
);
const TEXT = new TextEncoder();

const base64UrlDecode = (s: string): Uint8Array => {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    // oxlint-disable-next-line unicorn/prefer-code-point -- REVIEW: byte-level decode of a binary string; charCodeAt (UTF-16 unit, always defined) is the correct primitive here
    out[i] = bin.charCodeAt(i);
  }
  return out;
};

const importKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey(
    "raw",
    TEXT.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"]
  );

const hmac = async (secret: string, data: string): Promise<string> => {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, TEXT.encode(data));
  return base64UrlEncode(new Uint8Array(sig));
};

export interface SignTicketArgs {
  userId: string | null;
  stageId?: string | null;
  role?: WsRole;
  secret: string;
  // default 5 minutes
  ttlMs?: number;
}

export const signTicket = async ({
  userId,
  stageId = null,
  role = "screen",
  secret,
  ttlMs = 5 * 60 * 1000,
}: SignTicketArgs): Promise<string> => {
  const now = Date.now();
  const payload: WsTicketPayload = {
    exp: now + ttlMs,
    iat: now,
    role,
    stageId,
    userId,
  };
  const payloadB64 = base64UrlEncode(TEXT.encode(JSON.stringify(payload)));
  const sig = await hmac(secret, `${HEADER_B64}.${payloadB64}`);
  return `${HEADER_B64}.${payloadB64}.${sig}`;
};

// Constant-time string compare to avoid timing-oracle leaks.
const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    // oxlint-disable-next-line no-bitwise, unicorn/prefer-code-point -- REVIEW: constant-time compare needs bitwise OR/XOR; charCodeAt (always defined) is correct over codePointAt
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export const verifyTicket = async (
  token: string,
  secret: string
): Promise<WsTicketPayload | null> => {
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
  const stageIdOk =
    payload.stageId === undefined ||
    payload.stageId === null ||
    typeof payload.stageId === "string";
  const roleOk = payload.role === undefined || payload.role === "screen";
  if (!(stageIdOk && roleOk)) {
    return null;
  }
  // Default legacy payloads (previous build's tickets, ≤5 min in the wild).
  return { role: "screen", stageId: null, ...payload };
};
