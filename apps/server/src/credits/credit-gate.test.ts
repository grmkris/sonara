import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createLogger } from "@sonara/logger";
import {
  createPgLite,
  pgliteAsPool,
  type TestPg,
} from "@sonara/test-utils";
import {
  CREDIT_DENIAL_COOLDOWN_MS,
  COST_PER_FRAME,
  tryDebitCredit,
} from "./credit-gate";
import { __setPoolForTests } from "./credits.service";

const SCHEMA_SQL = `
CREATE TABLE credits (
  id uuid PRIMARY KEY NOT NULL,
  user_id uuid NOT NULL,
  balance_frames integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX credits_user_id_idx ON credits (user_id);

CREATE TABLE usage_ledger (
  id uuid PRIMARY KEY NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  delta integer NOT NULL,
  amount_cents integer,
  tx_hash text,
  chain_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE free_tier_ledger (
  user_id uuid NOT NULL,
  window_start timestamp with time zone NOT NULL,
  usage_count integer DEFAULT 0 NOT NULL,
  PRIMARY KEY (user_id, window_start)
);
`;

const USER = "00000000-0000-0000-0000-000000000001";
const NOW = 1_700_000_000_000;
const logger = createLogger({ name: "test", level: "silent" });

let pg: TestPg;

beforeAll(async () => {
  pg = createPgLite();
  await pg.exec(SCHEMA_SQL);
  __setPoolForTests(pgliteAsPool(pg));
});

afterAll(async () => {
  __setPoolForTests(null);
  await pg.close();
});

beforeEach(async () => {
  await pg.exec(
    `DELETE FROM usage_ledger; DELETE FROM credits; DELETE FROM free_tier_ledger;`,
  );
});

async function seedCredits(userId: string, frames: number): Promise<void> {
  await pg.query(
    `INSERT INTO credits (id, user_id, balance_frames)
     VALUES (gen_random_uuid(), $1, $2)`,
    [userId, frames],
  );
}

describe("paid debit", () => {
  test("deducts COST_PER_FRAME and returns paidCost for refund", async () => {
    await seedCredits(USER, 5);
    const r = await tryDebitCredit({
      userId: USER,
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      now: NOW,
      logger,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.paidCost).toBe(COST_PER_FRAME);
  });

  test("paid success resets nextLastDenialAt to 0", async () => {
    await seedCredits(USER, 5);
    const r = await tryDebitCredit({
      userId: USER,
      isUserInitiated: false,
      lastCreditDenialAt: NOW - 1000,
      now: NOW,
      logger,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.nextLastDenialAt).toBe(0);
  });
});

describe("free-tier fallback", () => {
  test("zero balance falls through to free tier", async () => {
    await seedCredits(USER, 0);
    const r = await tryDebitCredit({
      userId: USER,
      isUserInitiated: false,
      lastCreditDenialAt: 0,
      now: NOW,
      logger,
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
    for (let i = 0; i < 3; i++) {
      await tryDebitCredit({
        userId: USER,
        isUserInitiated: false,
        lastCreditDenialAt: 0,
        now: NOW,
        logger,
      });
    }
    // Fourth call exceeds the free quota
    const r = await tryDebitCredit({
      userId: USER,
      isUserInitiated: true,
      lastCreditDenialAt: 0,
      now: NOW,
      logger,
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
  async function drainFreeTier(): Promise<void> {
    await seedCredits(USER, 0);
    for (let i = 0; i < 3; i++) {
      await tryDebitCredit({
        userId: USER,
        isUserInitiated: false,
        lastCreditDenialAt: 0,
        now: NOW,
        logger,
      });
    }
  }

  test("first auto-trigger denial emits and stamps the denial timestamp", async () => {
    await drainFreeTier();
    const r = await tryDebitCredit({
      userId: USER,
      isUserInitiated: false,
      lastCreditDenialAt: 0,
      now: NOW,
      logger,
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
      userId: USER,
      isUserInitiated: false,
      lastCreditDenialAt: NOW - 1000, // 1s ago, well inside cooldown
      now: NOW,
      logger,
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
      userId: USER,
      isUserInitiated: false,
      lastCreditDenialAt: NOW - CREDIT_DENIAL_COOLDOWN_MS - 1000,
      now: NOW,
      logger,
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
      userId: USER,
      isUserInitiated: true,
      lastCreditDenialAt: NOW - 1000, // would suppress an auto trigger
      now: NOW,
      logger,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.shouldEmit).toBe(true);
      expect(r.nextLastDenialAt).toBe(NOW);
    }
  });
});
