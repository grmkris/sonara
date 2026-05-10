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
       VALUES ($1, $2, $3, -1, now())`,
      [newLedgerId(), userId, kind],
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
 * Inverse of `debitFrame`. Increments the matching balance and appends a
 * `kind: "refund"` ledger row with delta=+1 in the same transaction. Returns
 * the new balance, or `null` when the user has no `credits` row at all
 * (which means there was no prior debit to refund — caller should treat as
 * a no-op rather than an error).
 *
 * Use case: a fal generation fails after the credit was already debited.
 * The trigger version that paid is the version that gets refunded — callers
 * must capture `kind` at the debit site so the refund hits the right column.
 */
export async function refundFrame(
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
         SET ${col} = ${col} + 1, updated_at = now()
         WHERE user_id = $1
         RETURNING ${col} AS balance`,
      [userId],
    );
    if (upd.rowCount === 0) {
      // No row to refund into. Most likely the user was BYOK or never had a
      // credits row — caller should never have called us. Roll back and
      // return null so the trigger logs and moves on.
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `INSERT INTO usage_ledger (id, user_id, kind, delta, created_at)
       VALUES ($1, $2, 'refund', 1, now())`,
      [newLedgerId(), userId],
    );
    await client.query("COMMIT");
    return upd.rows[0]?.balance ?? 0;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger?.error({ err, userId, kind }, "refundFrame failed");
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
    await pool.end?.();
    pool = null;
  }
}
