import { SCHEMA } from "@sonara/db";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";

import { FRAME_COLUMNS, rowToFrame } from "./frame-mapping";
import { protectedProcedure } from "./procedures";

// User-scoped library router. Reads persisted generated/story frames for
// the /play gallery timeline (library-slice bootstraps + pages via `list`).
// Per-session and per-collection reads live on the sets router — the legacy
// session-summary / by-session procedures were retired in C5 along with the
// reel tables. Seed rows (the built-in starter decks) are served by the demo loop
// directly from static files and never returned here — the WHERE clause
// filters them out.
//
// Every returned row has its `url` re-signed on read so clients always
// get a fresh presigned URL with the full TTL (default 7d). Never store
// these URLs long-term on the client; refetch via list() to refresh.

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

export const libraryRouter = {
  /**
   * Paged all-time gallery, newest first. Cursor is the `createdAt` ISO
   * string of the last row from the previous page; next page is strictly
   * older than that.
   */
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
      })
    )
    .handler(async ({ input, context }) => {
      const { db, userId } = context;
      const limit = input.limit ?? LIST_DEFAULT_LIMIT;
      const cursorDate = input.cursor ? new Date(input.cursor) : null;

      const conditions = [
        eq(SCHEMA.imageLibrary.userId, userId),
        inArray(SCHEMA.imageLibrary.source, ["generated", "story"]),
      ];
      if (cursorDate) {
        conditions.push(lt(SCHEMA.imageLibrary.createdAt, cursorDate));
      }

      const rows = await db
        .select(FRAME_COLUMNS)
        .from(SCHEMA.imageLibrary)
        .where(and(...conditions))
        .orderBy(desc(SCHEMA.imageLibrary.createdAt))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const trimmed = hasMore ? rows.slice(0, limit) : rows;
      const frames = trimmed.map(rowToFrame);
      const nextCursor = hasMore
        ? (trimmed.at(-1)?.createdAt.toISOString() ?? null)
        : null;

      return { frames, nextCursor };
    }),
};
