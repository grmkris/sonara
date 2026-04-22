import pg from "pg";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Direct pg access — avoids pulling drizzle + schema types into apps/server
// just to run three atomic queries. Uses the same DATABASE_URL that apps/web
// uses for Better Auth.

let pool: pg.Pool | null = null;
function getPool(): pg.Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL not set — credits-service can't reach the DB",
      );
    }
    pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

export type FrameKind = "frame" | "commit";

/**
 * Atomic decrement of either `balance_frames` or `balance_commits`. Returns
 * the new balance if the row had at least 1 to spend, or `null` if
 * insufficient. A ledger row is written in the same tx for audit.
 *
 * Race-safe: single UPDATE with a WHERE clause; concurrent callers see either
 * the decrement or a 0-row result, never a double-spend.
 */
export async function debitFrame(
  userId: string,
  kind: FrameKind,
  logger?: Logger,
): Promise<number | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const col = kind === "frame" ? "balance_frames" : "balance_commits";
    const upd = await client.query<{ balance: number }>(
      `UPDATE credits
         SET ${col} = ${col} - 1, updated_at = now()
         WHERE user_id = $1 AND ${col} >= 1
         RETURNING ${col} AS balance`,
      [userId],
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO usage_ledger (id, user_id, kind, delta, created_at)
       VALUES (gen_random_uuid(), $1, $2, -1, now())`,
      [userId, kind],
    );
    await client.query("COMMIT");
    return upd.rows[0]?.balance ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger?.error({ err, userId, kind }, "debitFrame failed");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Try to consume one free-tier slot in the current hourly window. Returns
 * true iff the user was under the hourly limit. Composite PK on
 * (user_id, window_start) makes this race-safe without an explicit tx —
 * concurrent callers upsert onto the same row and the WHERE clause in the
 * UPDATE branch gates the increment.
 *
 * Not all Postgres versions honour conditional ON CONFLICT updates via
 * RETURNING + row count — we read the usage_count back and check against
 * the limit on the client side as a second guard.
 */
export async function tryConsumeFreeTier(
  userId: string,
  limitPerHour = 3,
  logger?: Logger,
): Promise<boolean> {
  const res = await getPool().query<{ usage_count: number }>(
    `INSERT INTO free_tier_ledger (user_id, window_start, usage_count)
       VALUES ($1, date_trunc('hour', now()), 1)
     ON CONFLICT (user_id, window_start)
       DO UPDATE SET usage_count = free_tier_ledger.usage_count + 1
         WHERE free_tier_ledger.usage_count < $2
     RETURNING usage_count`,
    [userId, limitPerHour],
  );
  if (res.rowCount === 0) return false;
  const count = res.rows[0]?.usage_count ?? 0;
  if (count > limitPerHour) return false;
  // Append a 'free' row to the ledger for consistent usage analytics.
  try {
    await getPool().query(
      `INSERT INTO usage_ledger (id, user_id, kind, delta, created_at)
       VALUES (gen_random_uuid(), $1, 'free', -1, now())`,
      [userId],
    );
  } catch (err) {
    logger?.warn({ err, userId }, "failed to append free-tier ledger row");
  }
  return true;
}

export async function getBalance(
  userId: string,
): Promise<{ frames: number; commits: number }> {
  const res = await getPool().query<{
    balance_frames: number;
    balance_commits: number;
  }>(
    `SELECT balance_frames, balance_commits FROM credits WHERE user_id = $1`,
    [userId],
  );
  if (res.rowCount === 0) return { frames: 0, commits: 0 };
  const row = res.rows[0]!;
  return { frames: row.balance_frames, commits: row.balance_commits };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
