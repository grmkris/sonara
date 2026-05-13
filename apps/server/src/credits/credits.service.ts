import { typeIdGenerator, typeIdToUuid } from "@music-visualizer/shared/typeid";
import pg from "pg";
import { env } from "../env";
import type { Logger } from "../lib/logger";

// Generate a fresh `usage_ledger` row id as a UUID. The DB column is `uuid`
// but the application layer thinks in typeid-prefixed strings — use the
// shared typeid generator so ledger rows from apps/server are time-sortable
// and round-trip through drizzle's `typeId` customType the same way as rows
// written via the web router.
function newLedgerId(): string {
  return typeIdToUuid(typeIdGenerator("usageLedger")).uuid;
}

// Direct pg access — avoids pulling drizzle + schema types into apps/server
// just to run three atomic queries. Uses the same DATABASE_URL that apps/web
// uses for Better Auth.

// Subset of `pg.Pool` used by this module. Defined as an interface so tests
// can substitute a pglite-backed shim without dragging the full pg surface
// into test-utils.
export interface PoolLike {
  connect(): Promise<{
    query<T = unknown>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: T[]; rowCount: number | null }>;
    release(): void;
  }>;
  query<T = unknown>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
  end?(): Promise<void>;
}

let pool: PoolLike | null = null;
function getPool(): PoolLike {
  if (!pool) {
    pool = new pg.Pool({ connectionString: env.DATABASE_URL });
  }
  return pool;
}

// Test-only override. Tests inject a pglite-backed shim; pass `null` to clear
// and force getPool() to rebuild from env on the next call. Not part of the
// production surface — never call from app code.
export function __setPoolForTests(p: PoolLike | null): void {
  pool = p;
}

/**
 * Atomic decrement of `balance_frames` by `cost`. Returns the new balance if
 * the user had at least `cost` to spend, or `null` if insufficient. A ledger
 * row is written in the same tx for audit.
 *
 * Cost model: every keyframe costs 1 (see COST_PER_FRAME in credit-gate.ts).
 * The `cost` parameter exists so callers can still pass an explicit number;
 * production always passes 1.
 *
 * Race-safe: single UPDATE with a WHERE clause; concurrent callers see
 * either the decrement or a 0-row result, never a double-spend.
 */
export async function debitFrame(
  userId: string,
  cost: number,
  logger?: Logger,
): Promise<number | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query<{ balance: number }>(
      `UPDATE credits
         SET balance_frames = balance_frames - $2, updated_at = now()
         WHERE user_id = $1 AND balance_frames >= $2
         RETURNING balance_frames AS balance`,
      [userId, cost],
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO usage_ledger (id, user_id, kind, delta, created_at)
       VALUES ($1, $2, 'frame', $3, now())`,
      [newLedgerId(), userId, -cost],
    );
    await client.query("COMMIT");
    return upd.rows[0]?.balance ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger?.error({ err, userId, cost }, "debitFrame failed");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Inverse of `debitFrame`. Increments `balance_frames` by `cost` and appends
 * a `kind: "refund"` ledger row with delta=+cost in the same transaction.
 * Returns the new balance, or `null` when the user has no `credits` row at
 * all (caller should treat as a no-op).
 *
 * Use case: a fal generation fails after the credit was already debited.
 */
export async function refundFrame(
  userId: string,
  cost: number,
  logger?: Logger,
): Promise<number | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const upd = await client.query<{ balance: number }>(
      `UPDATE credits
         SET balance_frames = balance_frames + $2, updated_at = now()
         WHERE user_id = $1
         RETURNING balance_frames AS balance`,
      [userId, cost],
    );
    if (upd.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO usage_ledger (id, user_id, kind, delta, created_at)
       VALUES ($1, $2, 'refund', $3, now())`,
      [newLedgerId(), userId, cost],
    );
    await client.query("COMMIT");
    return upd.rows[0]?.balance ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger?.error({ err, userId, cost }, "refundFrame failed");
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
       VALUES ($1, $2, 'free', -1, now())`,
      [newLedgerId(), userId],
    );
  } catch (err) {
    logger?.warn({ err, userId }, "failed to append free-tier ledger row");
  }
  return true;
}

export async function getBalance(userId: string): Promise<{ frames: number }> {
  const res = await getPool().query<{ balance_frames: number }>(
    `SELECT balance_frames FROM credits WHERE user_id = $1`,
    [userId],
  );
  if (res.rowCount === 0) return { frames: 0 };
  return { frames: res.rows[0]!.balance_frames };
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end?.();
    pool = null;
  }
}
