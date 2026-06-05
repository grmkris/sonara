import { describe, expect, test } from "bun:test";

import { signTicket, verifyTicket } from "./ws-ticket";

const SECRET = "test-secret-do-not-use-in-prod";
const USER_ID = "00000000-0000-0000-0000-000000000001";

describe("ws-ticket", () => {
  test("round-trip: sign then verify returns the payload", async () => {
    const token = await signTicket({ secret: SECRET, userId: USER_ID });
    const payload = await verifyTicket(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.userId).toBe(USER_ID);
    expect(typeof payload?.exp).toBe("number");
    expect(typeof payload?.iat).toBe("number");
    expect(payload!.exp).toBeGreaterThan(payload!.iat);
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
      ttlMs: -1, // already expired
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
});
