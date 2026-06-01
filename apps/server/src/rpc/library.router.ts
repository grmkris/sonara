import { type LibraryFrame } from "@sonara/shared";
import {
  type ImageLibraryId,
  type LiveSessionId,
  LiveSessionIdSchema,
} from "@sonara/shared/typeid";
import { SCHEMA } from "@sonara/db";
import { and, asc, desc, eq, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { presignReadUrl } from "../storage/bucket";
import { protectedProcedure } from "./procedures";

// User-scoped library router. Reads persisted generated/story frames for
// the gallery + timeline. Seed rows (the built-in starter decks) are
// served by the demo loop directly from static files and never returned
// here — the WHERE clause filters them out.
//
// Every returned row has its `url` re-signed on read so clients always
// get a fresh presigned URL with the full TTL (default 7d). Never store
// these URLs long-term on the client; refetch via list() to refresh.

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;

interface DbRow {
  id: ImageLibraryId;
  url: string;
  width: number;
  height: number;
  palette: string[] | null;
  deck: string;
  prompt: string;
  tMs: number | null;
  sessionId: LiveSessionId | null;
  createdAt: Date;
}

// Maps a DB row to the wire shape, presigning the stored bucket key. Rows
// whose tMs or sessionId is null (shouldn't happen for source='generated'
// rows, but defensive) get sensible defaults so the client never sees nulls.
function rowToFrame(row: DbRow): LibraryFrame {
  return {
    id: row.id,
    url: presignReadUrl(row.url),
    width: row.width,
    height: row.height,
    palette: row.palette,
    deck: row.deck,
    prompt: row.prompt,
    tMs: row.tMs ?? 0,
    sessionId: (row.sessionId ?? "") as LiveSessionId,
    createdAt: row.createdAt,
  };
}

export const libraryRouter = {
  /**
   * Paged all-time gallery, newest first. Cursor is the `createdAt` ISO
   * string of the last row from the previous page; next page is strictly
   * older than that.
   */
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
        cursor: z.string().datetime().optional(),
      }),
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
        .select({
          id: SCHEMA.imageLibrary.id,
          url: SCHEMA.imageLibrary.url,
          width: SCHEMA.imageLibrary.width,
          height: SCHEMA.imageLibrary.height,
          palette: SCHEMA.imageLibrary.palette,
          deck: SCHEMA.imageLibrary.deck,
          prompt: SCHEMA.imageLibrary.prompt,
          tMs: SCHEMA.imageLibrary.tMs,
          sessionId: SCHEMA.imageLibrary.sessionId,
          createdAt: SCHEMA.imageLibrary.createdAt,
        })
        .from(SCHEMA.imageLibrary)
        .where(and(...conditions))
        .orderBy(desc(SCHEMA.imageLibrary.createdAt))
        .limit(limit + 1); // fetch +1 to know if there's a next page

      const hasMore = rows.length > limit;
      const trimmed = hasMore ? rows.slice(0, limit) : rows;
      const frames = trimmed.map(rowToFrame);
      const nextCursor = hasMore
        ? trimmed[trimmed.length - 1]?.createdAt.toISOString() ?? null
        : null;

      return { frames, nextCursor };
    }),

  /**
   * All frames from a single live session, in chronological order. Used by
   * the timeline's "this session only" view. Lighter than `list` because
   * one session is bounded.
   */
  bySession: protectedProcedure
    .input(z.object({ sessionId: LiveSessionIdSchema }))
    .handler(async ({ input, context }) => {
      const { db, userId } = context;

      const rows = await db
        .select({
          id: SCHEMA.imageLibrary.id,
          url: SCHEMA.imageLibrary.url,
          width: SCHEMA.imageLibrary.width,
          height: SCHEMA.imageLibrary.height,
          palette: SCHEMA.imageLibrary.palette,
          deck: SCHEMA.imageLibrary.deck,
          prompt: SCHEMA.imageLibrary.prompt,
          tMs: SCHEMA.imageLibrary.tMs,
          sessionId: SCHEMA.imageLibrary.sessionId,
          createdAt: SCHEMA.imageLibrary.createdAt,
        })
        .from(SCHEMA.imageLibrary)
        .where(
          and(
            eq(SCHEMA.imageLibrary.userId, userId),
            eq(SCHEMA.imageLibrary.sessionId, input.sessionId),
            inArray(SCHEMA.imageLibrary.source, ["generated", "story"]),
          ),
        )
        .orderBy(asc(SCHEMA.imageLibrary.tMs));

      return { frames: rows.map(rowToFrame) };
    }),
};
