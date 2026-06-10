import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";

import { createLogger } from "@sonara/logger";
import { typeIdGenerator, typeIdToUuid } from "@sonara/shared/typeid";
import type { UserId } from "@sonara/shared/typeid";
import { createTestUser } from "@sonara/test-utils/factories";
import { getTestDb } from "@sonara/test-utils/test-db";
import type { TestDb } from "@sonara/test-utils/test-db";

import {
  CREDIT_DENIAL_COOLDOWN_MS,
  COST_PER_FRAME,
  tryDebitCredit,
} from "./credit-gate";
import { __setPoolForTests } from "./credits.service";

// The credit gate works in raw-uuid space; derive the actor uuid from a real
// typeid so the user-row factory insert round-trips cleanly.
const USER_ID = typeIdGenerator("user") as UserId;
const USER = typeIdToUuid(USER_ID).uuid;
const NOW = 1_700_000_000_000;
const logger = createLogger({ level: "silent", name: "test" });

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
  // "user".id — the raw-uuid actor needs a backing user row.
  await createTestUser(t.db, { id: USER_ID });
});

const seedCredits = async (userId: string, frames: number): Promise<void> => {
  await t.pg.query(
    `INSERT INTO credits (id, user_id, balance_frames)
     VALUES (gen_random_uuid(), $1, $2)`,
    [userId, frames]
  );
};

describe("paid debit", () => {
  test("deducts COST_PER_FRAME and returns paidCost for refund", async () => {
    await seedCredits(USER, 5);
    const r = await tryDebitCredit({
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paidCost).toBe(COST_PER_FRAME);
    }
  });

  test("paid success resets nextLastDenialAt to 0", async () => {
    await seedCredits(USER, 5);
    const r = await tryDebitCredit({
      isUserInitiated: false,
      lastCreditDenialAt: NOW - 1000,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nextLastDenialAt).toBe(0);
    }
  });
});

describe("free-tier fallback", () => {
  test("zero balance falls through to free tier", async () => {
    await seedCredits(USER, 0);
    const r = await tryDebitCredit({
      isUserInitiated: false,
      lastCreditDenialAt: 0,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.paidCost).toBeNull();
      expect(r.nextLastDenialAt).toBe(0);
    }
  });

  test("free tier exhausted → denial with shouldEmit on user-initiated", async () => {
    // Drain the hourly quota first
    await seedCredits(USER, 0);
    for (let i = 0; i < 3; i += 1) {
      await tryDebitCredit({
        isUserInitiated: false,
        lastCreditDenialAt: 0,
        logger,
        now: NOW,
        userId: USER,
      });
    }
    // Fourth call exceeds the free quota
    const r = await tryDebitCredit({
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe("out_of_credits");
      expect(r.shouldEmit).toBe(true);
    }
  });
});

describe("cooldown rule", () => {
  // To exercise the cooldown we need genuine denials. Bump the user past the
  // free-tier quota by reusing the row in the same hour window — see test
  // helper above. Each test seeds fresh state in beforeEach, so we pre-drain
  // here.
  const drainFreeTier = async (): Promise<void> => {
    await seedCredits(USER, 0);
    for (let i = 0; i < 3; i += 1) {
      await tryDebitCredit({
        isUserInitiated: false,
        lastCreditDenialAt: 0,
        logger,
        now: NOW,
        userId: USER,
      });
    }
  };

  test("first auto-trigger denial emits and stamps the denial timestamp", async () => {
    await drainFreeTier();
    const r = await tryDebitCredit({
      isUserInitiated: false,
      lastCreditDenialAt: 0,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.shouldEmit).toBe(true);
      expect(r.nextLastDenialAt).toBe(NOW);
    }
  });

  test("second auto-trigger denial inside cooldown window suppresses emit", async () => {
    await drainFreeTier();
    const r = await tryDebitCredit({
      isUserInitiated: false,
      // 1s ago, well inside cooldown
      lastCreditDenialAt: NOW - 1000,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.shouldEmit).toBe(false);
      // Doesn't update the timestamp when suppressed
      expect(r.nextLastDenialAt).toBe(NOW - 1000);
    }
  });

  test("auto-trigger denial AFTER cooldown elapses re-emits", async () => {
    await drainFreeTier();
    const r = await tryDebitCredit({
      isUserInitiated: false,
      lastCreditDenialAt: NOW - CREDIT_DENIAL_COOLDOWN_MS - 1000,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.shouldEmit).toBe(true);
      expect(r.nextLastDenialAt).toBe(NOW);
    }
  });

  test("user-initiated denial always emits, ignores cooldown", async () => {
    await drainFreeTier();
    const r = await tryDebitCredit({
      isUserInitiated: true,
      // would suppress an auto trigger
      lastCreditDenialAt: NOW - 1000,
      logger,
      now: NOW,
      userId: USER,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.shouldEmit).toBe(true);
      expect(r.nextLastDenialAt).toBe(NOW);
    }
  });
});
