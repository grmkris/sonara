import { SCHEMA } from "@sonara/db";
import { LiveSessionIdSchema } from "@sonara/shared/typeid";
import type { LiveSessionId } from "@sonara/shared/typeid";
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
} from "drizzle-orm";
import { z } from "zod";

import {
  buildExampleFrames,
  buildExampleSessions,
  deckFromExampleSessionId,
  isExampleSessionId,
} from "../library/example-sessions";
import { presignReadUrl } from "../storage/bucket";
import { FRAME_COLUMNS, rowToFrame } from "./frame-mapping";
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

export const libraryRouter = {
  /**
   * All frames from a single live session, in chronological order. Used by
   * the /play timeline strip's per-session view AND by the /studio session
   * timeline. Lighter than `list` because one session is bounded.
   */
  bySession: protectedProcedure
    .input(z.object({ sessionId: LiveSessionIdSchema }))
    .handler(async ({ input, context }) => {
      const { db, userId } = context;

      // Example sessions (studio prefill) are synthesized from seed decks and
      // never hit the DB — short-circuit before the owned-rows query.
      if (isExampleSessionId(input.sessionId)) {
        const frames = await buildExampleFrames(
          db,
          deckFromExampleSessionId(input.sessionId)
        );
        return { frames };
      }

      const rows = await db
        .select(FRAME_COLUMNS)
        .from(SCHEMA.imageLibrary)
        .where(
          and(
            eq(SCHEMA.imageLibrary.userId, userId),
            eq(SCHEMA.imageLibrary.sessionId, input.sessionId),
            inArray(SCHEMA.imageLibrary.source, ["generated", "story"])
          )
        )
        .orderBy(asc(SCHEMA.imageLibrary.tMs));

      return { frames: rows.map(rowToFrame) };
    }),

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

  /**
   * Session summaries — grouped overview for the /studio sessions sidebar.
   * Returns each session's frame count, first/last frame timestamps,
   * total duration, and a sample URL (newest frame in that session).
   * Cursor pagination on `lastFrameAt`.
   */
  sessions: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(SESSIONS_MAX_LIMIT).optional(),
      })
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
          firstFrameAt: min(SCHEMA.imageLibrary.createdAt),
          frameCount: count(SCHEMA.imageLibrary.id),
          lastFrameAt: max(SCHEMA.imageLibrary.createdAt),
          // Session-relative audio offsets — duration is computed from these
          // (the `tMs` axis) so the sidebar agrees with the timeline, which
          // also measures in tMs. Wall-clock createdAt would over-count any
          // paused stretch.
          maxTMs: max(SCHEMA.imageLibrary.tMs),
          minTMs: min(SCHEMA.imageLibrary.tMs),
          sessionId: SCHEMA.imageLibrary.sessionId,
        })
        .from(SCHEMA.imageLibrary)
        .where(and(...conditions))
        .groupBy(SCHEMA.imageLibrary.sessionId)
        // Filter on aggregate via HAVING for cursor pagination.
        .having(
          cursorDate
            ? lt(max(SCHEMA.imageLibrary.createdAt), cursorDate)
            : undefined
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

      // DISTINCT ON (sessionId) newest frame per session, via Drizzle so the
      // typeId column driver converts `userId` (typeid → uuid) automatically —
      // no hand-written `::uuid` cast. orderBy must lead with the distinct col.
      const sampleRows = sessionIds.length
        ? await db
            .selectDistinctOn([SCHEMA.imageLibrary.sessionId], {
              sessionId: SCHEMA.imageLibrary.sessionId,
              url: SCHEMA.imageLibrary.url,
            })
            .from(SCHEMA.imageLibrary)
            .where(
              and(
                eq(SCHEMA.imageLibrary.userId, userId),
                inArray(SCHEMA.imageLibrary.sessionId, sessionIds),
                inArray(SCHEMA.imageLibrary.source, ["generated", "story"])
              )
            )
            .orderBy(
              asc(SCHEMA.imageLibrary.sessionId),
              desc(SCHEMA.imageLibrary.createdAt)
            )
        : [];

      const samplesByKey = new Map<string, string>();
      for (const r of sampleRows) {
        if (r.sessionId) {
          samplesByKey.set(r.sessionId, r.url);
        }
      }

      const sessions = trimmed.map((g) => {
        const sessionId = g.sessionId as LiveSessionId;
        const key = samplesByKey.get(sessionId);
        const firstAt = g.firstFrameAt as Date;
        const lastAt = g.lastFrameAt as Date;
        return {
          // tMs axis (see the aggregate select) — matches the timeline.
          durationMs: (g.maxTMs ?? 0) - (g.minTMs ?? 0),
          firstFrameAt: firstAt,
          frameCount: Number(g.frameCount),
          lastFrameAt: lastAt,
          sampleUrl: key ? presignReadUrl(key) : null,
          sessionId,
        };
      });

      const nextCursor = hasMore
        ? ((trimmed.at(-1)?.lastFrameAt as Date | undefined)?.toISOString() ??
          null)
        : null;

      // Studio prefill: a signed-in user with no real sessions gets example
      // sessions synthesized from the seed decks so the editor lands populated
      // rather than empty. Only on the first page (no cursor) — paging past
      // the (empty) real set shouldn't resurface examples.
      if (sessions.length === 0 && !cursorDate) {
        const examples = await buildExampleSessions(db);
        return { nextCursor: null, sessions: examples };
      }

      return { nextCursor, sessions };
    }),
};
