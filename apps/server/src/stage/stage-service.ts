import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import type { StageId, UserId } from "@sonara/shared/typeid";
import { and, eq } from "drizzle-orm";

import { mintCode } from "./stage-rooms";

// Durable stage rows — the named places an account performs at
// (docs/rooms-and-roles-plan.md rev 2). This service owns identity only;
// live-run state (current lse_, attached screen, crowd access) lives in the
// session registry.

export interface StageRow {
  code: string;
  id: StageId;
  isDefault: boolean;
  name: string;
  userId: UserId;
}

const DEFAULT_STAGE_NAME = "Your stage";

const toRow = (r: typeof SCHEMA.stage.$inferSelect): StageRow => ({
  code: r.code,
  id: r.id,
  isDefault: r.isDefault,
  name: r.name,
  userId: r.userId,
});

// Insert a stage row, re-minting the code on a unique-index collision. The
// partial default-index can also conflict (concurrent default creation) — the
// caller treats a null return as "someone else won, re-select".
const tryInsertStage = async (
  db: Database,
  values: { isDefault: boolean; name: string; userId: UserId }
): Promise<StageRow | null> => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inserted = await db
      .insert(SCHEMA.stage)
      .values({ ...values, code: mintCode() })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      return toRow(inserted[0]);
    }
    if (values.isDefault) {
      // Could be the default-per-user index, not the code — let the caller
      // re-select instead of burning retries on an unwinnable race.
      const existing = await db
        .select()
        .from(SCHEMA.stage)
        .where(
          and(
            eq(SCHEMA.stage.userId, values.userId),
            eq(SCHEMA.stage.isDefault, true)
          )
        )
        .limit(1);
      if (existing[0]) {
        return toRow(existing[0]);
      }
    }
  }
  return null;
};

// The lazily-created "Your stage" — what bare /play and /control resolve to.
// Race-safe: concurrent callers converge on one row via the partial unique
// index (user_id WHERE is_default) + insert-on-conflict-do-nothing.
export const resolveDefaultStage = async (
  db: Database,
  userId: UserId
): Promise<StageRow> => {
  const existing = await db
    .select()
    .from(SCHEMA.stage)
    .where(and(eq(SCHEMA.stage.userId, userId), eq(SCHEMA.stage.isDefault, true)))
    .limit(1);
  if (existing[0]) {
    return toRow(existing[0]);
  }
  const created = await tryInsertStage(db, {
    isDefault: true,
    name: DEFAULT_STAGE_NAME,
    userId,
  });
  if (!created) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Could not create your stage — please retry.",
    });
  }
  return created;
};

// Explicitly created, named extra stage ("Main floor", "Bar screen").
export const createStage = async (
  db: Database,
  userId: UserId,
  name: string
): Promise<StageRow> => {
  const created = await tryInsertStage(db, {
    isDefault: false,
    name,
    userId,
  });
  if (!created) {
    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "Could not create the stage — please retry.",
    });
  }
  return created;
};

// Owned lookup for routers. Unknown id → NOT_FOUND; someone else's stage →
// FORBIDDEN (mirrors resolveOwnedStageRun's split).
export const getOwnedStage = async (
  db: Database,
  userId: UserId,
  stageId: StageId
): Promise<StageRow> => {
  const rows = await db
    .select()
    .from(SCHEMA.stage)
    .where(eq(SCHEMA.stage.id, stageId))
    .limit(1);
  const [row] = rows;
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Unknown stage." });
  }
  if (row.userId !== userId) {
    throw new ORPCError("FORBIDDEN");
  }
  return toRow(row);
};

export const findStageByCode = async (
  db: Database,
  code: string
): Promise<StageRow | null> => {
  const rows = await db
    .select()
    .from(SCHEMA.stage)
    .where(eq(SCHEMA.stage.code, code.toUpperCase()))
    .limit(1);
  return rows[0] ? toRow(rows[0]) : null;
};

export const listStages = async (
  db: Database,
  userId: UserId
): Promise<StageRow[]> => {
  const rows = await db
    .select()
    .from(SCHEMA.stage)
    .where(eq(SCHEMA.stage.userId, userId))
    .orderBy(SCHEMA.stage.createdAt);
  return rows.map(toRow);
};

export const renameStage = async (
  db: Database,
  userId: UserId,
  stageId: StageId,
  name: string
): Promise<void> => {
  await getOwnedStage(db, userId, stageId);
  await db
    .update(SCHEMA.stage)
    .set({ name })
    .where(eq(SCHEMA.stage.id, stageId));
};
