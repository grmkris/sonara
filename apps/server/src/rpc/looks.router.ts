import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { LookConfig } from "@sonara/shared";
import type { LookProfile } from "@sonara/shared";
import { LookProfileIdSchema } from "@sonara/shared/typeid";
import type { LookProfileId, UserId } from "@sonara/shared/typeid";
import { and, desc, eq, lt } from "drizzle-orm";
import { z } from "zod";

import { protectedProcedure, publicProcedure } from "./procedures";

// Saved visual "look profiles" — a named render config (PresetConfig) persisted
// per-account, mirroring the sets surface (owned, visibility-gated). Used by
// BOTH the screen (save/list/apply) and the remote console (list/apply); the
// active look is relayed separately via control.setLook (see control.router).

const NAME_MAX = 120;
const LIST_MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

type LookRow = typeof SCHEMA.lookProfile.$inferSelect;

const toProfile = (row: LookRow): LookProfile => ({
  config: row.config,
  createdAt: row.createdAt,
  id: row.id,
  name: row.name,
  visibility: row.visibility,
});

const requireOwnedLook = async (
  db: Database,
  userId: UserId,
  lookId: LookProfileId
): Promise<LookRow> => {
  const [row] = await db
    .select()
    .from(SCHEMA.lookProfile)
    .where(eq(SCHEMA.lookProfile.id, lookId))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Look not found." });
  }
  if (row.userId !== userId) {
    throw new ORPCError("FORBIDDEN");
  }
  return row;
};

export const looksRouter = {
  create: protectedProcedure
    .input(
      z.object({
        config: LookConfig,
        name: z.string().trim().min(1).max(NAME_MAX),
      })
    )
    .handler(async ({ context, input }): Promise<{ look: LookProfile }> => {
      const { db, userId } = context;
      const [row] = await db
        .insert(SCHEMA.lookProfile)
        .values({ config: input.config, name: input.name, userId })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      return { look: toProfile(row) };
    }),

  // Public read behind the optional-auth gate: owners see private looks,
  // others only non-private. Missing + private-to-others both → NOT_FOUND.
  get: publicProcedure
    .input(z.object({ lookId: LookProfileIdSchema }))
    .handler(async ({ context, input }): Promise<LookProfile> => {
      const { db } = context;
      const userId = context.session?.user.id ?? null;
      const [row] = await db
        .select()
        .from(SCHEMA.lookProfile)
        .where(eq(SCHEMA.lookProfile.id, input.lookId))
        .limit(1);
      const canRead =
        row &&
        (row.visibility !== "private" ||
          (userId !== null && row.userId === userId));
      if (!(row && canRead)) {
        throw new ORPCError("NOT_FOUND", { message: "Look not found." });
      }
      return toProfile(row);
    }),

  list: protectedProcedure
    .input(
      z
        .object({
          cursor: z.string().datetime().optional(),
          limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
        })
        .optional()
    )
    .handler(
      async ({
        context,
        input,
      }): Promise<{ looks: LookProfile[]; nextCursor: string | null }> => {
        const { db, userId } = context;
        const limit = input?.limit ?? DEFAULT_LIMIT;
        const conditions = [eq(SCHEMA.lookProfile.userId, userId)];
        if (input?.cursor) {
          conditions.push(
            lt(SCHEMA.lookProfile.createdAt, new Date(input.cursor))
          );
        }
        const rows = await db
          .select()
          .from(SCHEMA.lookProfile)
          .where(and(...conditions))
          .orderBy(desc(SCHEMA.lookProfile.createdAt))
          .limit(limit + 1);
        const page = rows.slice(0, limit);
        const nextCursor =
          rows.length > limit
            ? (page.at(-1)?.createdAt.toISOString() ?? null)
            : null;
        return { looks: page.map(toProfile), nextCursor };
      }
    ),

  remove: protectedProcedure
    .input(z.object({ lookId: LookProfileIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedLook(db, userId, input.lookId);
      await db
        .delete(SCHEMA.lookProfile)
        .where(eq(SCHEMA.lookProfile.id, input.lookId));
      return { ok: true as const };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        lookId: LookProfileIdSchema,
        name: z.string().trim().min(1).max(NAME_MAX),
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedLook(db, userId, input.lookId);
      await db
        .update(SCHEMA.lookProfile)
        .set({ name: input.name })
        .where(eq(SCHEMA.lookProfile.id, input.lookId));
      return { ok: true as const };
    }),
};
