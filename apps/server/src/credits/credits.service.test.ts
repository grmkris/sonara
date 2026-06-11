import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { createTestUser } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";

import {
  __setPoolForTests,
  debitFrame,
  getBalance,
  refundFrame,
  tryConsumeFreeTier,
} from "./credits.service";

// The credits service works in raw-uuid space; derive the actor uuids from
// real typeids so the user-row factory inserts round-trip cleanly.
const USER_ID = typeIdGenerator("user") as UserId;
const USER2_ID = typeIdGenerator("user") as UserId;
const USER = typeIdToUuid(USER_ID).uuid;
const USER2 = typeIdToUuid(USER2_ID).uuid;

let t: TestDb;

beforeAll(async () => {
  t = await getTestDb();
  __setPoolForTests(t.pool);
}, 30_000);

afterAll(() => {
  __setPoolForTests(null);
});

beforeEach(async () => {
  await t.reset();
  // Real migrations FK credits/usage_ledger/free_tier_ledger.user_id to
  // "user".id — the raw-uuid actors need backing user rows.
  await createTestUser(t.db, { id: USER_ID });
  await createTestUser(t.db, { id: USER2_ID });
});

const seedCredits = async (userId: string, frames: number): Promise<void> => {
  await t.pg.query(
    `INSERT INTO credits (id, user_id, balance_frames)
     VALUES (gen_random_uuid(), $1, $2)`,
    [userId, frames]
  );
};

const ledgerCount = async (): Promise<number> => {
  const res = await t.pg.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM usage_ledger`
  );
  return Number(res.rows[0]?.count ?? 0);
};

describe("debitFrame", () => {
  test("decrements balance_frames by cost when sufficient", async () => {
    await seedCredits(USER, 5);
    expect(await debitFrame(USER, 1)).toBe(4);
    expect(await ledgerCount()).toBe(1);
  });

  test("decrements by an arbitrary cost", async () => {
    await seedCredits(USER, 5);
    expect(await debitFrame(USER, 2)).toBe(3);
  });

  test("returns null when balance < cost", async () => {
    await seedCredits(USER, 1);
    expect(await debitFrame(USER, 2)).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  test("returns null when balance is 0", async () => {
    await seedCredits(USER, 0);
    expect(await debitFrame(USER, 1)).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  test("returns null when no credits row exists for the user", async () => {
    expect(await debitFrame(USER, 1)).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  test.skip("two parallel debits on a 1-frame balance — exactly one succeeds", () => {});
});

describe("tryConsumeFreeTier", () => {
  test("allows up to limitPerHour calls in the same window", async () => {
    expect(await tryConsumeFreeTier(USER, 3)).toBe(true);
    expect(await tryConsumeFreeTier(USER, 3)).toBe(true);
    expect(await tryConsumeFreeTier(USER, 3)).toBe(true);
    expect(await tryConsumeFreeTier(USER, 3)).toBe(false);
  });

  test("denies even the first call when limit is 0", async () => {
    expect(await tryConsumeFreeTier(USER, 0)).toBe(false);
  });

  test("each user has independent quota", async () => {
    await tryConsumeFreeTier(USER, 1);
    expect(await tryConsumeFreeTier(USER, 1)).toBe(false);
    expect(await tryConsumeFreeTier(USER2, 1)).toBe(true);
  });

  test("rolls over on a new hour window", async () => {
    expect(await tryConsumeFreeTier(USER, 1)).toBe(true);
    expect(await tryConsumeFreeTier(USER, 1)).toBe(false);
    await t.pg.query(
      `UPDATE free_tier_ledger
         SET window_start = window_start - interval '1 hour'
         WHERE user_id = $1`,
      [USER]
    );
    expect(await tryConsumeFreeTier(USER, 1)).toBe(true);
  });

  test("appends a kind=free row to usage_ledger on success", async () => {
    expect(await tryConsumeFreeTier(USER, 3)).toBe(true);
    const res = await t.pg.query<{ kind: string; delta: number }>(
      `SELECT kind, delta FROM usage_ledger WHERE user_id = $1`,
      [USER]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]?.kind).toBe("free");
    expect(res.rows[0]?.delta).toBe(-1);
  });
});

describe("refundFrame", () => {
  test("increments balance_frames by cost + writes a refund ledger row", async () => {
    await seedCredits(USER, 4);
    expect(await refundFrame(USER, 1)).toBe(5);
    const res = await t.pg.query<{ kind: string; delta: number }>(
      `SELECT kind, delta FROM usage_ledger WHERE user_id = $1`,
      [USER]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]?.kind).toBe("refund");
    expect(res.rows[0]?.delta).toBe(1);
  });

  test("refund increments by an arbitrary cost", async () => {
    await seedCredits(USER, 4);
    expect(await refundFrame(USER, 2)).toBe(6);
  });

  test("returns null when user has no credits row", async () => {
    expect(await refundFrame(USER, 1)).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  test("debit followed by refund leaves balance unchanged", async () => {
    await seedCredits(USER, 10);
    expect(await debitFrame(USER, 1)).toBe(9);
    expect(await refundFrame(USER, 1)).toBe(10);
    const res = await t.pg.query<{ sum: string }>(
      `SELECT COALESCE(SUM(delta), 0)::text AS sum FROM usage_ledger WHERE user_id = $1`,
      [USER]
    );
    expect(Number(res.rows[0]?.sum ?? 0)).toBe(0);
  });
});

describe("getBalance", () => {
  test("returns {frames: 0} for users without a credits row", async () => {
    expect(await getBalance(USER)).toEqual({ frames: 0 });
  });

  test("returns the current balance after seeding", async () => {
    await seedCredits(USER, 42);
    expect(await getBalance(USER)).toEqual({ frames: 42 });
  });

  test("reflects the post-debit balance", async () => {
    await seedCredits(USER, 10);
    await debitFrame(USER, 2);
    expect(await getBalance(USER)).toEqual({ frames: 8 });
  });
});
