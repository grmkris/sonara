import { beforeAll, describe, expect, test } from "bun:test";

import { createRouterClient, ORPCError } from "@orpc/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { verifyTicket } from "@sonara/shared";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { createTestStage, createTestUser } from "@sonara/test-utils/factories";
import { makeServerCtx } from "@sonara/test-utils/orpc";
import { getTestDb } from "@sonara/test-utils/test-db";
import { eq } from "drizzle-orm";

import { env } from "../env";
import { authRouter } from "./auth.router";
import type { ServerHttpContext } from "./procedures";

// mintWsTicket resolves the caller's stage at mint time: anon → null stage,
// authed → lazily-created default stage (or an explicitly named OWNED stage).
// The WS upgrade then trusts the HMAC'd stageId without a DB round trip.

let db: Database;
const userA = typeIdGenerator("user") as UserId;
const userB = typeIdGenerator("user") as UserId;

const makeClient = (userId: UserId | null) =>
  createRouterClient(authRouter, {
    context: makeServerCtx({ db, userId }) as ServerHttpContext,
  });

beforeAll(async () => {
  const t = await getTestDb();
  ({ db } = t);
  await t.reset();
  await createTestUser(db, { id: userA });
  await createTestUser(db, { id: userB });
}, 30_000);

describe("auth.mintWsTicket", () => {
  test("anon: ticket verifies with null userId and stageId", async () => {
    const { token } = await makeClient(null).mintWsTicket();
    const payload = await verifyTicket(token, env.BETTER_AUTH_SECRET);
    expect(payload?.userId).toBeNull();
    expect(payload?.stageId).toBeNull();
    expect(payload?.role).toBe("screen");
  });

  test("authed: lazily creates the default stage and pins it", async () => {
    const { token } = await makeClient(userA).mintWsTicket();
    const payload = await verifyTicket(token, env.BETTER_AUTH_SECRET);
    expect(payload?.userId).toBe(typeIdToUuid(userA).uuid);

    const rows = await db
      .select()
      .from(SCHEMA.stage)
      .where(eq(SCHEMA.stage.userId, userA));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isDefault).toBe(true);
    expect(rows[0]?.name).toBe("Your stage");
    expect(payload?.stageId).toBe(rows[0]?.id ?? "");

    // Second mint reuses the same stage — no row growth.
    const again = await makeClient(userA).mintWsTicket();
    const payload2 = await verifyTicket(again.token, env.BETTER_AUTH_SECRET);
    expect(payload2?.stageId).toBe(payload?.stageId ?? "");
  });

  test("explicit stageId: owned resolves, foreign is FORBIDDEN", async () => {
    const mine = await createTestStage(db, { userId: userA });
    const { token } = await makeClient(userA).mintWsTicket({
      stageId: mine.id,
    });
    const payload = await verifyTicket(token, env.BETTER_AUTH_SECRET);
    expect(payload?.stageId).toBe(mine.id);

    try {
      await makeClient(userB).mintWsTicket({ stageId: mine.id });
      expect.unreachable("foreign stage must not mint");
    } catch (error) {
      expect(error).toBeInstanceOf(ORPCError);
      expect((error as { code: string }).code).toBe("FORBIDDEN");
    }
  });
});
