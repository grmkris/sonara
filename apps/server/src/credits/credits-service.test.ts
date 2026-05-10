import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import {
  createPgLite,
  pgliteAsPool,
  type TestPg,
} from "@music-visualizer/test-utils";
import {
  __setPoolForTests,
  debitFrame,
  getBalance,
  tryConsumeFreeTier,
} from "./credits-service";

// Subset of apps/web/drizzle/0000_*.sql — only the credits / ledger tables
// the service touches. FKs to "user" are dropped because we never insert a
// user row in these tests; user_id is just a uuid placeholder.
const SCHEMA_SQL = `
CREATE TABLE credits (
  id uuid PRIMARY KEY NOT NULL,
  user_id uuid NOT NULL,
  balance_frames integer DEFAULT 0 NOT NULL,
  balance_commits integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX credits_user_id_idx ON credits (user_id);

CREATE TABLE usage_ledger (
  id uuid PRIMARY KEY NOT NULL,
  user_id uuid NOT NULL,
  kind text NOT NULL,
  delta integer NOT NULL,
  amount_usd text,
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
const USER2 = "00000000-0000-0000-0000-000000000002";

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

async function seedCredits(
  userId: string,
  frames: number,
  commits = 0,
): Promise<void> {
  await pg.query(
    `INSERT INTO credits (id, user_id, balance_frames, balance_commits)
     VALUES (gen_random_uuid(), $1, $2, $3)`,
    [userId, frames, commits],
  );
}

async function ledgerCount(): Promise<number> {
  const res = await pg.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM usage_ledger`,
  );
  return Number(res.rows[0]?.count ?? 0);
}

describe("debitFrame", () => {
  test("decrements balance_frames when balance >= 1", async () => {
    await seedCredits(USER, 5, 0);
    const remaining = await debitFrame(USER, "frame");
    expect(remaining).toBe(4);
    expect(await ledgerCount()).toBe(1);
  });

  test("decrements balance_commits when kind=commit", async () => {
    await seedCredits(USER, 0, 3);
    const remaining = await debitFrame(USER, "commit");
    expect(remaining).toBe(2);
  });

  test("returns null and writes no ledger row when balance is 0", async () => {
    await seedCredits(USER, 0, 0);
    const remaining = await debitFrame(USER, "frame");
    expect(remaining).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  test("returns null when no credits row exists for the user", async () => {
    const remaining = await debitFrame(USER, "frame");
    expect(remaining).toBeNull();
    expect(await ledgerCount()).toBe(0);
  });

  // True parallel-debit race-safety needs a real pg.Pool with multiple
  // connections — pglite is single-connection and serializes transactions,
  // so two concurrent BEGIN/UPDATE/COMMIT sequences interleave incorrectly
  // and don't reproduce the production behavior. Sequential safety is
  // covered by "returns null when balance is 0" plus the WHERE-clause
  // semantics; concurrent safety is asserted by inspection of the SQL
  // (single UPDATE with WHERE balance >= 1; row-level lock by Postgres).
  test.skip("two parallel debits on a 1-frame balance — exactly one succeeds", () => {});

  test("commit kind cannot debit from balance_frames", async () => {
    await seedCredits(USER, 5, 0);
    const remaining = await debitFrame(USER, "commit");
    expect(remaining).toBeNull();
    // Frames untouched.
    const balance = await getBalance(USER);
    expect(balance.frames).toBe(5);
  });
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
    // Manually backdate the existing row so date_trunc('hour', now()) lands
    // on a fresh window — simulates an hour passing.
    await pg.query(
      `UPDATE free_tier_ledger
         SET window_start = window_start - interval '1 hour'
         WHERE user_id = $1`,
      [USER],
    );
    expect(await tryConsumeFreeTier(USER, 1)).toBe(true);
  });

  test("appends a kind=free row to usage_ledger on success", async () => {
    expect(await tryConsumeFreeTier(USER, 3)).toBe(true);
    const res = await pg.query<{ kind: string; delta: number }>(
      `SELECT kind, delta FROM usage_ledger WHERE user_id = $1`,
      [USER],
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0]?.kind).toBe("free");
    expect(res.rows[0]?.delta).toBe(-1);
  });
});

describe("getBalance", () => {
  test("returns {0, 0} for users without a credits row", async () => {
    const balance = await getBalance(USER);
    expect(balance).toEqual({ frames: 0, commits: 0 });
  });

  test("returns the current balance after seeding", async () => {
    await seedCredits(USER, 42, 7);
    expect(await getBalance(USER)).toEqual({ frames: 42, commits: 7 });
  });

  test("reflects the post-debit balance", async () => {
    await seedCredits(USER, 10, 5);
    await debitFrame(USER, "frame");
    await debitFrame(USER, "commit");
    expect(await getBalance(USER)).toEqual({ frames: 9, commits: 4 });
  });
});
