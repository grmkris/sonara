import {
  type InspectorContext,
  type LibraryFrame,
} from "@sonara/shared";
import {
  type ImageLibraryId,
  type LiveSessionId,
  LiveSessionIdSchema,
} from "@sonara/shared/typeid";
import { SCHEMA } from "@sonara/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  lt,
  max,
  min,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { presignReadUrl } from "../storage/bucket";
import { protectedProcedure } from "./procedures";

// User-scoped library router. Reads persisted generated/story frames for
// the gallery, timeline, and /studio editor. Seed rows (the built-in
// starter decks) are served by the demo loop directly from static files
// and never returned here — the WHERE clause filters them out.
//
// Every returned row has its `url` re-signed on read so clients always
// get a fresh presigned URL with the full TTL (default 7d). Never store
// these URLs long-term on the client; refetch via list() / session() to
// refresh.

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;
const SESSIONS_DEFAULT_LIMIT = 20;
const SESSIONS_MAX_LIMIT = 50;

interface FrameRow {
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
  triggerReason: string | null;
  anchorUrl: string | null;
  inspectorContext: InspectorContext | null;
}

// Maps a DB row to the wire shape, presigning the stored bucket key. Rows
// whose tMs or sessionId is null (shouldn't happen for source='generated'
// rows, but defensive) get sensible defaults so the client never sees nulls.
function rowToFrame(row: FrameRow): LibraryFrame {
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
    triggerReason: row.triggerReason,
    anchorUrl: row.anchorUrl,
    inspectorContext: row.inspectorContext,
  };
}

const FRAME_COLUMNS = {
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
  triggerReason: SCHEMA.imageLibrary.triggerReason,
  anchorUrl: SCHEMA.imageLibrary.anchorUrl,
  inspectorContext: SCHEMA.imageLibrary.inspectorContext,
} as const;

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
        .select(FRAME_COLUMNS)
        .from(SCHEMA.imageLibrary)
        .where(and(...conditions))
        .orderBy(desc(SCHEMA.imageLibrary.createdAt))
        .limit(limit + 1);

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
   * the /play timeline strip's per-session view AND by the /studio session
   * timeline. Lighter than `list` because one session is bounded.
   */
  bySession: protectedProcedure
    .input(z.object({ sessionId: LiveSessionIdSchema }))
    .handler(async ({ input, context }) => {
      const { db, userId } = context;

      const rows = await db
        .select(FRAME_COLUMNS)
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

  /**
   * Session summaries — grouped overview for the /studio sessions sidebar.
   * Returns each session's frame count, first/last frame timestamps,
   * total duration, and a sample URL (newest frame in that session).
   * Cursor pagination on `lastFrameAt`.
   */
  sessions: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(SESSIONS_MAX_LIMIT).optional(),
        cursor: z.string().datetime().optional(),
      }),
    )
    .handler(async ({ input, context }) => {
      const { db, userId } = context;
      const limit = input.limit ?? SESSIONS_DEFAULT_LIMIT;
      const cursorDate = input.cursor ? new Date(input.cursor) : null;

      // Group by sessionId. We exclude rows where sessionId IS NULL
      // (defence — generated/story rows should always have one).
      const conditions = [
        eq(SCHEMA.imageLibrary.userId, userId),
        inArray(SCHEMA.imageLibrary.source, ["generated", "story"]),
        isNotNull(SCHEMA.imageLibrary.sessionId),
      ];

      // Aggregate per session. Drizzle exposes count/min/max as runtime
      // helpers; the GROUP BY expression is on sessionId only.
      const grouped = await db
        .select({
          sessionId: SCHEMA.imageLibrary.sessionId,
          frameCount: count(SCHEMA.imageLibrary.id),
          firstFrameAt: min(SCHEMA.imageLibrary.createdAt),
          lastFrameAt: max(SCHEMA.imageLibrary.createdAt),
        })
        .from(SCHEMA.imageLibrary)
        .where(and(...conditions))
        .groupBy(SCHEMA.imageLibrary.sessionId)
        // Filter on aggregate via HAVING for cursor pagination.
        .having(
          cursorDate
            ? lt(max(SCHEMA.imageLibrary.createdAt), cursorDate)
            : undefined,
        )
        .orderBy(desc(max(SCHEMA.imageLibrary.createdAt)))
        .limit(limit + 1);

      const hasMore = grouped.length > limit;
      const trimmed = hasMore ? grouped.slice(0, limit) : grouped;

      // Secondary query for the sample url per session. Picks the newest
      // frame in each session via DISTINCT ON (sessionId) + createdAt DESC.
      // Could be one query with window functions but two-step is simpler
      // for SESSIONS_MAX_LIMIT=50 sessions.
      const sessionIds = trimmed
        .map((g) => g.sessionId)
        .filter((id): id is LiveSessionId => id !== null);

      const sampleRows = sessionIds.length
        ? await db.execute<{ session_id: string; url: string }>(
            sql`SELECT DISTINCT ON (session_id) session_id, url
                  FROM image_library
                 WHERE user_id = ${userId}::uuid
                   AND session_id = ANY(${sessionIds})
                   AND source IN ('generated', 'story')
                 ORDER BY session_id, created_at DESC`,
          )
        : { rows: [] as Array<{ session_id: string; url: string }> };

      const samplesByKey = new Map<string, string>();
      for (const r of sampleRows.rows) {
        samplesByKey.set(r.session_id, r.url);
      }

      const sessions = trimmed.map((g) => {
        const sessionId = g.sessionId as LiveSessionId;
        const key = samplesByKey.get(sessionId);
        const firstAt = g.firstFrameAt as Date;
        const lastAt = g.lastFrameAt as Date;
        return {
          sessionId,
          frameCount: Number(g.frameCount),
          firstFrameAt: firstAt,
          lastFrameAt: lastAt,
          sampleUrl: key ? presignReadUrl(key) : null,
          durationMs: lastAt.getTime() - firstAt.getTime(),
        };
      });

      const nextCursor = hasMore
        ? (trimmed[trimmed.length - 1]?.lastFrameAt as Date | undefined)
            ?.toISOString() ?? null
        : null;

      return { sessions, nextCursor };
    }),
};
