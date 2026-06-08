import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import type { Reel, ReelSummary } from "@sonara/shared";
import { ImageLibraryIdSchema, ReelIdSchema } from "@sonara/shared/typeid";
import type { ImageLibraryId, ReelId, UserId } from "@sonara/shared/typeid";
import { and, asc, count, desc, eq, inArray, lt, max } from "drizzle-orm";
import { z } from "zod";

import { presignReadUrl } from "../storage/bucket";
import { FRAME_COLUMNS, rowToFrame } from "./frame-mapping";
import { protectedProcedure } from "./procedures";

// User-curated reels: named, ordered collections of frames. A reel references
// frames (via reel_frame) — it never copies them; the image lives once in
// image_library. Every owner check compares the typeid string directly
// (SCHEMA.reel.userId is a typeId column; the driver converts to uuid for us —
// unlike control.router, which compares against an in-memory raw uuid).

const LIST_DEFAULT_LIMIT = 30;
const LIST_MAX_LIMIT = 50;
const NAME_MAX = 120;

interface OwnedReel {
  id: ReelId;
  userId: UserId;
  name: string;
  coverFrameId: ImageLibraryId | null;
  createdAt: Date;
}

// Loads a reel and asserts the caller owns it. Unknown id → NOT_FOUND;
// someone else's reel → FORBIDDEN.
const requireOwnedReel = async (
  db: Database,
  userId: UserId,
  reelId: ReelId
): Promise<OwnedReel> => {
  const [row] = await db
    .select({
      coverFrameId: SCHEMA.reel.coverFrameId,
      createdAt: SCHEMA.reel.createdAt,
      id: SCHEMA.reel.id,
      name: SCHEMA.reel.name,
      userId: SCHEMA.reel.userId,
    })
    .from(SCHEMA.reel)
    .where(eq(SCHEMA.reel.id, reelId))
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Reel not found." });
  }
  if (row.userId !== userId) {
    throw new ORPCError("FORBIDDEN");
  }
  return row;
};

// Asserts the frame exists and belongs to the caller (frames can only be added
// to a reel by their owner).
const requireOwnedFrame = async (
  db: Database,
  userId: UserId,
  frameId: ImageLibraryId
): Promise<void> => {
  const [row] = await db
    .select({ id: SCHEMA.imageLibrary.id })
    .from(SCHEMA.imageLibrary)
    .where(
      and(
        eq(SCHEMA.imageLibrary.id, frameId),
        eq(SCHEMA.imageLibrary.userId, userId)
      )
    )
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Frame not found." });
  }
};

export const reelRouter = {
  /**
   * Add a frame to a curated reel, appended at the end. Idempotent: re-adding a
   * frame already in the reel is a no-op (unique (reel_id, frame_id)).
   */
  addFrame: protectedProcedure
    .input(
      z.object({ frameId: ImageLibraryIdSchema, reelId: ReelIdSchema })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);
      await requireOwnedFrame(db, userId, input.frameId);

      const [agg] = await db
        .select({ maxPos: max(SCHEMA.reelFrame.position) })
        .from(SCHEMA.reelFrame)
        .where(eq(SCHEMA.reelFrame.reelId, input.reelId));
      const nextPosition = (agg?.maxPos ?? -1) + 1;

      await db
        .insert(SCHEMA.reelFrame)
        .values({
          frameId: input.frameId,
          position: nextPosition,
          reelId: input.reelId,
        })
        .onConflictDoNothing({
          target: [SCHEMA.reelFrame.reelId, SCHEMA.reelFrame.frameId],
        });
      return { ok: true as const };
    }),

  /** Create a new (empty) curated reel. */
  create: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(NAME_MAX) }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      // Bare .returning() (no selection) — the NodePg/Pglite union exposes only
      // the 0-arg overload to callers; full row is fine, we pick what we need.
      const [row] = await db
        .insert(SCHEMA.reel)
        .values({ name: input.name, userId })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      const reel: ReelSummary = {
        coverUrl: null,
        createdAt: row.createdAt,
        frameCount: 0,
        id: row.id,
        name: row.name,
      };
      return { reel };
    }),

  /** Full reel: header + ordered frames (freshly presigned urls). */
  get: protectedProcedure
    .input(z.object({ reelId: ReelIdSchema }))
    .handler(async ({ context, input }): Promise<Reel> => {
      const { db, userId } = context;
      const owned = await requireOwnedReel(db, userId, input.reelId);

      const rows = await db
        .select(FRAME_COLUMNS)
        .from(SCHEMA.reelFrame)
        .innerJoin(
          SCHEMA.imageLibrary,
          eq(SCHEMA.reelFrame.frameId, SCHEMA.imageLibrary.id)
        )
        .where(eq(SCHEMA.reelFrame.reelId, input.reelId))
        .orderBy(asc(SCHEMA.reelFrame.position));

      const frames = rows.map(rowToFrame);
      // Cover: explicit cover frame if it's still a member, else the first frame.
      let coverUrl: string | null = frames[0]?.url ?? null;
      if (owned.coverFrameId) {
        const explicit = frames.find((f) => f.id === owned.coverFrameId);
        if (explicit) {
          coverUrl = explicit.url;
        }
      }
      return {
        coverFrameId: owned.coverFrameId,
        coverUrl,
        createdAt: owned.createdAt,
        frames,
        id: owned.id,
        name: owned.name,
      };
    }),

  /**
   * Curated reels for the signed-in user, newest first. Cursor is the
   * `createdAt` ISO string of the last row from the previous page.
   */
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const limit = input.limit ?? LIST_DEFAULT_LIMIT;
      const cursorDate = input.cursor ? new Date(input.cursor) : null;

      const conditions = [eq(SCHEMA.reel.userId, userId)];
      if (cursorDate) {
        conditions.push(lt(SCHEMA.reel.createdAt, cursorDate));
      }

      const reels = await db
        .select({
          coverFrameId: SCHEMA.reel.coverFrameId,
          createdAt: SCHEMA.reel.createdAt,
          id: SCHEMA.reel.id,
          name: SCHEMA.reel.name,
        })
        .from(SCHEMA.reel)
        .where(and(...conditions))
        .orderBy(desc(SCHEMA.reel.createdAt))
        .limit(limit + 1);

      const hasMore = reels.length > limit;
      const trimmed = hasMore ? reels.slice(0, limit) : reels;
      const reelIds = trimmed.map((r) => r.id);

      // frameCount per reel (one grouped query).
      const countByReel = new Map<string, number>();
      // Fallback cover (first frame per reel) — DISTINCT ON (reel_id) by position.
      const firstFrameByReel = new Map<string, string>();
      if (reelIds.length > 0) {
        const counts = await db
          .select({
            frameCount: count(SCHEMA.reelFrame.id),
            reelId: SCHEMA.reelFrame.reelId,
          })
          .from(SCHEMA.reelFrame)
          .where(inArray(SCHEMA.reelFrame.reelId, reelIds))
          .groupBy(SCHEMA.reelFrame.reelId);
        for (const c of counts) {
          countByReel.set(c.reelId, Number(c.frameCount));
        }

        const firstFrames = await db
          .selectDistinctOn([SCHEMA.reelFrame.reelId], {
            reelId: SCHEMA.reelFrame.reelId,
            url: SCHEMA.imageLibrary.url,
          })
          .from(SCHEMA.reelFrame)
          .innerJoin(
            SCHEMA.imageLibrary,
            eq(SCHEMA.reelFrame.frameId, SCHEMA.imageLibrary.id)
          )
          .where(inArray(SCHEMA.reelFrame.reelId, reelIds))
          .orderBy(asc(SCHEMA.reelFrame.reelId), asc(SCHEMA.reelFrame.position));
        for (const f of firstFrames) {
          firstFrameByReel.set(f.reelId, f.url);
        }
      }

      // Explicit cover urls (only for reels that set one).
      const coverIds = trimmed
        .map((r) => r.coverFrameId)
        .filter((id): id is ImageLibraryId => id !== null);
      const coverUrlById = new Map<string, string>();
      if (coverIds.length > 0) {
        const coverRows = await db
          .select({
            id: SCHEMA.imageLibrary.id,
            url: SCHEMA.imageLibrary.url,
          })
          .from(SCHEMA.imageLibrary)
          .where(inArray(SCHEMA.imageLibrary.id, coverIds));
        for (const c of coverRows) {
          coverUrlById.set(c.id, c.url);
        }
      }

      const summaries: ReelSummary[] = trimmed.map((r) => {
        const coverKey =
          (r.coverFrameId ? coverUrlById.get(r.coverFrameId) : undefined) ??
          firstFrameByReel.get(r.id) ??
          null;
        return {
          coverUrl: coverKey ? presignReadUrl(coverKey) : null,
          createdAt: r.createdAt,
          frameCount: countByReel.get(r.id) ?? 0,
          id: r.id,
          name: r.name,
        };
      });

      const nextCursor = hasMore
        ? (trimmed.at(-1)?.createdAt.toISOString() ?? null)
        : null;
      return { nextCursor, reels: summaries };
    }),

  /** Delete a reel (cascades reel_frame; underlying frames are untouched). */
  remove: protectedProcedure
    .input(z.object({ reelId: ReelIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);
      await db.delete(SCHEMA.reel).where(eq(SCHEMA.reel.id, input.reelId));
      return { ok: true as const };
    }),

  /** Remove a frame from a curated reel (positions left with a gap; harmless). */
  removeFrame: protectedProcedure
    .input(z.object({ frameId: ImageLibraryIdSchema, reelId: ReelIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);
      await db
        .delete(SCHEMA.reelFrame)
        .where(
          and(
            eq(SCHEMA.reelFrame.reelId, input.reelId),
            eq(SCHEMA.reelFrame.frameId, input.frameId)
          )
        );
      return { ok: true as const };
    }),

  rename: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(NAME_MAX),
        reelId: ReelIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);
      await db
        .update(SCHEMA.reel)
        .set({ name: input.name })
        .where(eq(SCHEMA.reel.id, input.reelId));
      return { ok: true as const };
    }),

  /**
   * Rewrite the authored order. `orderedFrameIds` must be exactly the reel's
   * current members (same multiset). Done in a transaction with an offset bump
   * to dodge the non-deferrable unique (reel_id, position) index.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        orderedFrameIds: z.array(ImageLibraryIdSchema),
        reelId: ReelIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);

      const current = await db
        .select({ frameId: SCHEMA.reelFrame.frameId })
        .from(SCHEMA.reelFrame)
        .where(eq(SCHEMA.reelFrame.reelId, input.reelId));

      const currentSorted = current.map((r) => r.frameId).toSorted();
      const inputSorted = input.orderedFrameIds.toSorted();
      const sameSet =
        currentSorted.length === inputSorted.length &&
        currentSorted.every((id, i) => id === inputSorted[i]);
      if (!sameSet) {
        throw new ORPCError("BAD_REQUEST", {
          message: "orderedFrameIds must match the reel's current frames.",
        });
      }

      const OFFSET = 1_000_000;
      await db.transaction(async (tx) => {
        // Vacate the position range so sequential assignment never collides.
        for (const [i, frameId] of input.orderedFrameIds.entries()) {
          await tx
            .update(SCHEMA.reelFrame)
            .set({ position: i + OFFSET })
            .where(
              and(
                eq(SCHEMA.reelFrame.reelId, input.reelId),
                eq(SCHEMA.reelFrame.frameId, frameId)
              )
            );
        }
        for (const [i, frameId] of input.orderedFrameIds.entries()) {
          await tx
            .update(SCHEMA.reelFrame)
            .set({ position: i })
            .where(
              and(
                eq(SCHEMA.reelFrame.reelId, input.reelId),
                eq(SCHEMA.reelFrame.frameId, frameId)
              )
            );
        }
      });
      return { ok: true as const };
    }),

  /** Set (or change) the cover frame. The frame must be a member of the reel. */
  setCover: protectedProcedure
    .input(z.object({ frameId: ImageLibraryIdSchema, reelId: ReelIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedReel(db, userId, input.reelId);
      const [member] = await db
        .select({ id: SCHEMA.reelFrame.id })
        .from(SCHEMA.reelFrame)
        .where(
          and(
            eq(SCHEMA.reelFrame.reelId, input.reelId),
            eq(SCHEMA.reelFrame.frameId, input.frameId)
          )
        )
        .limit(1);
      if (!member) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That frame is not in this reel.",
        });
      }
      await db
        .update(SCHEMA.reel)
        .set({ coverFrameId: input.frameId })
        .where(eq(SCHEMA.reel.id, input.reelId));
      return { ok: true as const };
    }),
};
