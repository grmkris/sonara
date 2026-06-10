import { describe, expect, test } from "bun:test";

import { signTicket, verifyTicket } from "./ws-ticket";

const SECRET = "test-secret-do-not-use-in-prod";
const USER_ID = "00000000-0000-0000-0000-000000000001";

const b64 = (s: string): string =>
  btoa(s).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");

describe("ws-ticket", () => {
  test("round-trip: sign then verify returns the payload", async () => {
    const token = await signTicket({ secret: SECRET, userId: USER_ID });
    const payload = await verifyTicket(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(USER_ID);
    expect(typeof payload?.exp).toBe("number");
    expect(typeof payload?.iat).toBe("number");
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0);
  });

  test("rejects a token signed with a different secret", async () => {
    const token = await signTicket({ secret: SECRET, userId: USER_ID });
    const payload = await verifyTicket(token, "wrong-secret");
    expect(payload).toBeNull();
  });

  test("rejects a token whose payload was tampered", async () => {
    const token = await signTicket({ secret: SECRET, userId: USER_ID });
    const [header, payload, sig] = token.split(".");
    // Flip one bit in the payload segment — signature won't match.
    const tampered = `${header}.${payload}A.${sig}`;
    const verified = await verifyTicket(tampered, SECRET);
    expect(verified).toBeNull();
  });

  test("rejects an expired token", async () => {
    const token = await signTicket({
      secret: SECRET,
      // already expired
      ttlMs: -1,
      userId: USER_ID,
    });
    const payload = await verifyTicket(token, SECRET);
    expect(payload).toBeNull();
  });

  test("rejects a malformed token", async () => {
    expect(await verifyTicket("", SECRET)).toBeNull();
    expect(await verifyTicket("only.two", SECRET)).toBeNull();
    expect(await verifyTicket("a.b.c.d", SECRET)).toBeNull();
  });

  test("round-trip: anon ticket (null userId) verifies", async () => {
    const token = await signTicket({ secret: SECRET, userId: null });
    const payload = await verifyTicket(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBeNull();
    expect(typeof payload?.exp).toBe("number");
  });

  test("round-trip: stageId + role survive", async () => {
    const token = await signTicket({
      role: "screen",
      secret: SECRET,
      stageId: "stg_01h455vb4pex5vsknk084sn02q",
      userId: USER_ID,
    });
    const payload = await verifyTicket(token, SECRET);
    expect(payload?.stageId).toBe("stg_01h455vb4pex5vsknk084sn02q");
    expect(payload?.role).toBe("screen");
  });

  test("legacy payload (no stageId/role) verifies with defaults", async () => {
    // Hand-build a previous-build token: payload has only userId/exp/iat.
    // Mirrors the ≤5-min deploy window where old tickets are still in flight.
    const now = Date.now();
    const header = { alg: "HS256", typ: "ws-ticket" };
    const payload = { exp: now + 60_000, iat: now, userId: USER_ID };
    const headerB64 = b64(JSON.stringify(header));
    const payloadB64 = b64(JSON.stringify(payload));
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { hash: "SHA-256", name: "HMAC" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    );
    const sigB64 = b64(String.fromCodePoint(...new Uint8Array(sig)));
    const verified = await verifyTicket(
      `${headerB64}.${payloadB64}.${sigB64}`,
      SECRET
    );
    expect(verified).not.toBeNull();
    expect(verified?.stageId).toBeNull();
    expect(verified?.role).toBe("screen");
  });
});
