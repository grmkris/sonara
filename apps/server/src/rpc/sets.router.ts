import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import {
  FrameSetVisibilitySchema,
  VISUAL_PRESET_NAMES,
  canSeeUnlistedDecks,
} from "@sonara/shared";
import type { FrameSet, FrameSetSummary } from "@sonara/shared";
import {
  FrameSetIdSchema,
  ImageLibraryIdSchema,
  typeIdFromUuid,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import type {
  FrameSetId,
  ImageLibraryId,
  LiveSessionId,
  StageId,
  UserId,
} from "@sonara/shared/typeid";
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lt,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";

import { stageRooms } from "../stage/stage-rooms";
import { stageState } from "../stage/stage-state";
import { FRAME_COLUMNS, frameReadUrl, rowToFrame } from "./frame-mapping";
import { protectedProcedure, publicProcedure } from "./procedures";

// The unified Set surface (frame_set): built-in decks, session recordings and
// curated cuts behind one router. Successor of reel.router (same
// Photos→Albums model — a set references image_library rows, never copies).
//
// Mutation policy ("freeze"):
//   builtin    immutable for everyone (system-owned, user_id null — the
//              ownership check rejects all callers).
//   recording  frame list frozen (it's the take — provenance); metadata
//              (rename / cover / visibility / delete) stays editable. "Make a
//              cut" (create { fromSetId }) is the edit path.
//   curated    fully editable by the owner.
//
// `get` is PUBLIC (optional auth) — it's the read path behind the /s/[id]
// permalink replay: owners see everything; everyone else needs
// visibility != 'private'. Missing and private-to-others both surface as
// NOT_FOUND so a private set's existence doesn't leak.

// The durable stage's permanent code for a live run (stage-keyed runs only)
// — lets /s/<id>/control redirect to the per-stage console.
const durableStageCode = async (
  db: Database,
  stageId: string | null
): Promise<string | null> => {
  if (!stageId) {
    return null;
  }
  const rows = await db
    .select({ code: SCHEMA.stage.code })
    .from(SCHEMA.stage)
    .where(eq(SCHEMA.stage.id, stageId as StageId))
    .limit(1);
  return rows[0]?.code ?? null;
};

const LIST_DEFAULT_LIMIT = 50;
const LIST_MAX_LIMIT = 100;
const NAME_MAX = 120;
const BATCH_FRAMES_MAX = 200;

const SET_COLUMNS = {
  coverFrameId: SCHEMA.frameSet.coverFrameId,
  createdAt: SCHEMA.frameSet.createdAt,
  deckKey: SCHEMA.frameSet.deckKey,
  frameCount: SCHEMA.frameSet.frameCount,
  id: SCHEMA.frameSet.id,
  liveSessionId: SCHEMA.frameSet.liveSessionId,
  lookCadenceCalmMs: SCHEMA.frameSet.lookCadenceCalmMs,
  lookCadenceLoudMs: SCHEMA.frameSet.lookCadenceLoudMs,
  lookIntensity: SCHEMA.frameSet.lookIntensity,
  lookPreset: SCHEMA.frameSet.lookPreset,
  name: SCHEMA.frameSet.name,
  origin: SCHEMA.frameSet.origin,
  status: SCHEMA.frameSet.status,
  styleDrift: SCHEMA.frameSet.styleDrift,
  userId: SCHEMA.frameSet.userId,
  visibility: SCHEMA.frameSet.visibility,
} as const;

type SetRow = {
  [K in keyof typeof SET_COLUMNS]: (typeof SET_COLUMNS)[K]["_"]["data"] | null;
} & {
  id: FrameSetId;
  name: string;
  origin: "builtin" | "recording" | "curated";
  status: "recording" | "final";
  visibility: "private" | "unlisted" | "public";
  frameCount: number;
  createdAt: Date;
};

const loadSet = async (
  db: Database,
  setId: FrameSetId
): Promise<SetRow | undefined> => {
  // The typeid validator only checks the prefix; an undecodable suffix makes
  // the typeId column's toDriver throw mid-query. `get` is public — malformed
  // ids must read as "not found", never a 500.
  try {
    const [row] = await db
      .select(SET_COLUMNS)
      .from(SCHEMA.frameSet)
      .where(eq(SCHEMA.frameSet.id, setId))
      .limit(1);
    return row as SetRow | undefined;
  } catch {
    return undefined;
  }
};

// Loads a set and asserts the caller owns it. Builtin sets are system-owned
// (userId null) so every caller gets FORBIDDEN — which is exactly the
// immutability we want for them.
const requireOwnedSet = async (
  db: Database,
  userId: UserId,
  setId: FrameSetId
): Promise<SetRow> => {
  const row = await loadSet(db, setId);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: "Set not found." });
  }
  if (row.userId !== userId) {
    throw new ORPCError("FORBIDDEN");
  }
  return row;
};

// Frame-list mutations are curated-only: a recording's frame list is the
// performance — edit it by making a cut, not by rewriting history.
const requireEditableFrameList = (set: SetRow): void => {
  if (set.origin !== "curated") {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "This set's frame list is frozen — make a cut to edit a copy of it.",
    });
  }
};

// Frames can only be hand-added to a set by their owner (same rule reels had).
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

// Batch form of requireOwnedFrame: every frame must exist AND belong to the
// caller — verified in ONE query. A single foreign/missing id anywhere in the
// list rejects the whole batch (same NOT_FOUND shape as the single-frame
// check, so existence of someone else's frame doesn't leak). Returns the
// input deduped in first-occurrence order — the order inserts should use.
const requireOwnedFrames = async (
  db: Database,
  userId: UserId,
  frameIds: ImageLibraryId[]
): Promise<ImageLibraryId[]> => {
  const unique = [...new Set(frameIds)];
  const rows = await db
    .select({ id: SCHEMA.imageLibrary.id })
    .from(SCHEMA.imageLibrary)
    .where(
      and(
        inArray(SCHEMA.imageLibrary.id, unique),
        eq(SCHEMA.imageLibrary.userId, userId)
      )
    );
  if (rows.length !== unique.length) {
    throw new ORPCError("NOT_FOUND", { message: "Frame not found." });
  }
  return unique;
};

const canRead = (set: SetRow, userId: UserId | null): boolean =>
  set.visibility !== "private" || (userId !== null && set.userId === userId);

// A look exists only when all four authored values are present (they're
// written atomically by setLook / the boot converger).
const toLook = (row: SetRow): FrameSetSummary["look"] =>
  row.lookPreset !== null &&
  row.lookIntensity !== null &&
  row.lookCadenceCalmMs !== null &&
  row.lookCadenceLoudMs !== null
    ? {
        cadence: { calm: row.lookCadenceCalmMs, loud: row.lookCadenceLoudMs },
        intensity: row.lookIntensity,
        preset: row.lookPreset,
      }
    : null;

const toSummary = (row: SetRow, coverUrl: string | null): FrameSetSummary => ({
  coverUrl,
  createdAt: row.createdAt,
  deckKey: row.deckKey,
  frameCount: row.frameCount,
  id: row.id,
  liveSessionId: row.liveSessionId,
  look: toLook(row),
  name: row.name,
  origin: row.origin,
  status: row.status,
  styleDrift: row.styleDrift,
  visibility: row.visibility,
});

// Two-pass position rewrites jump rows into this disjoint band first so the
// non-deferrable unique (set_id, position) index never sees a transient
// collision. Far above any real position (sets cap at BATCH_FRAMES_MAX).
const REORDER_OFFSET = 1_000_000;

const bumpFrameCount = async (
  db: Database,
  setId: FrameSetId,
  delta: number
): Promise<void> => {
  await db
    .update(SCHEMA.frameSet)
    .set({ frameCount: sql`greatest(frame_count + ${delta}, 0)` })
    .where(eq(SCHEMA.frameSet.id, setId));
};

export const setsRouter = {
  /**
   * Add a frame to a curated set, appended at the end. Idempotent: re-adding
   * a member frame is a no-op (unique (set_id, frame_id)).
   */
  addFrame: protectedProcedure
    .input(z.object({ frameId: ImageLibraryIdSchema, setId: FrameSetIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const set = await requireOwnedSet(db, userId, input.setId);
      requireEditableFrameList(set);
      await requireOwnedFrame(db, userId, input.frameId);

      const [agg] = await db
        .select({ maxPos: max(SCHEMA.frameSetFrame.position) })
        .from(SCHEMA.frameSetFrame)
        .where(eq(SCHEMA.frameSetFrame.setId, input.setId));
      const nextPosition = (agg?.maxPos ?? -1) + 1;

      const inserted = await db
        .insert(SCHEMA.frameSetFrame)
        .values({
          frameId: input.frameId,
          position: nextPosition,
          setId: input.setId,
        })
        .onConflictDoNothing({
          target: [SCHEMA.frameSetFrame.setId, SCHEMA.frameSetFrame.frameId],
        })
        .returning();
      if (inserted.length > 0) {
        await bumpFrameCount(db, input.setId, 1);
      }
      return { ok: true as const };
    }),

  /**
   * Batch addFrame: add many frames to a curated set in INPUT order.
   * Idempotent per frame — frames already in the set are skipped
   * (unique (set_id, frame_id)) and `added` reflects only the real inserts.
   * All-or-nothing on validation: one foreign frame anywhere in the list
   * rejects the whole batch.
   *
   * `atPosition` (optional) is a DISPLAY index into the ordered member list —
   * NOT a raw `position` value (removeFrame leaves gaps, so raw positions and
   * display indices diverge). Omitted → append after the current max
   * (untouched fast path). Given → splice: the tail shifts up by the insert
   * count via the same two-pass offset trick reorder uses (the unique
   * (set_id, position) index is non-deferrable), then the block lands in the
   * opened gap. Clamped to the member count.
   */
  addFrames: protectedProcedure
    .input(
      z.object({
        atPosition: z.number().int().min(0).optional(),
        frameIds: z.array(ImageLibraryIdSchema).min(1).max(BATCH_FRAMES_MAX),
        setId: FrameSetIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const set = await requireOwnedSet(db, userId, input.setId);
      requireEditableFrameList(set);
      const frameIds = await requireOwnedFrames(db, userId, input.frameIds);

      const added = await db.transaction(async (tx) => {
        if (input.atPosition === undefined) {
          // Append fast path (the original behavior, byte for byte).
          const [agg] = await tx
            .select({ maxPos: max(SCHEMA.frameSetFrame.position) })
            .from(SCHEMA.frameSetFrame)
            .where(eq(SCHEMA.frameSetFrame.setId, input.setId));
          const basePosition = (agg?.maxPos ?? -1) + 1;

          const inserted = await tx
            .insert(SCHEMA.frameSetFrame)
            .values(
              frameIds.map((frameId, i) => ({
                frameId,
                position: basePosition + i,
                setId: input.setId,
              }))
            )
            .onConflictDoNothing({
              target: [SCHEMA.frameSetFrame.setId, SCHEMA.frameSetFrame.frameId],
            })
            .returning();
          if (inserted.length > 0) {
            await tx
              .update(SCHEMA.frameSet)
              .set({
                frameCount: sql`greatest(frame_count + ${inserted.length}, 0)`,
              })
              .where(eq(SCHEMA.frameSet.id, input.setId));
          }
          return inserted.map((r) => r.frameId);
        }

        // Splice path. Read the ordered members once — both for the display-
        // index → raw-position mapping and to drop already-member frames
        // (their positions must NOT move; splicing them is reorder's job).
        const members = await tx
          .select({
            frameId: SCHEMA.frameSetFrame.frameId,
            position: SCHEMA.frameSetFrame.position,
          })
          .from(SCHEMA.frameSetFrame)
          .where(eq(SCHEMA.frameSetFrame.setId, input.setId))
          .orderBy(asc(SCHEMA.frameSetFrame.position));
        const memberIds = new Set(members.map((m) => m.frameId));
        const newIds = frameIds.filter((id) => !memberIds.has(id));
        if (newIds.length === 0) {
          return [] as ImageLibraryId[];
        }
        const idx = Math.min(input.atPosition, members.length);
        const threshold =
          members[idx]?.position ?? (members.at(-1)?.position ?? -1) + 1;

        // Two-pass tail shift: jump the tail into a disjoint band first
        // (REORDER_OFFSET is far above any live position), then land it
        // +count above where it was — no transient unique collisions.
        await tx
          .update(SCHEMA.frameSetFrame)
          .set({
            position: sql`position + ${REORDER_OFFSET + newIds.length}`,
          })
          .where(
            and(
              eq(SCHEMA.frameSetFrame.setId, input.setId),
              gte(SCHEMA.frameSetFrame.position, threshold)
            )
          );
        await tx
          .update(SCHEMA.frameSetFrame)
          .set({ position: sql`position - ${REORDER_OFFSET}` })
          .where(
            and(
              eq(SCHEMA.frameSetFrame.setId, input.setId),
              gte(SCHEMA.frameSetFrame.position, REORDER_OFFSET)
            )
          );
        const inserted = await tx
          .insert(SCHEMA.frameSetFrame)
          .values(
            newIds.map((frameId, i) => ({
              frameId,
              position: threshold + i,
              setId: input.setId,
            }))
          )
          // Membership verified absent above, inside this tx — kept anyway
          // for parity with the append path.
          .onConflictDoNothing({
            target: [SCHEMA.frameSetFrame.setId, SCHEMA.frameSetFrame.frameId],
          })
          .returning();
        if (inserted.length > 0) {
          await tx
            .update(SCHEMA.frameSet)
            .set({
              frameCount: sql`greatest(frame_count + ${inserted.length}, 0)`,
            })
            .where(eq(SCHEMA.frameSet.id, input.setId));
        }
        return inserted.map((r) => r.frameId);
      });
      // `addedIds` = the frames that actually landed (dedupe-survivors) — the
      // exact inverse payload for the client's undo (removeFrames).
      return { added: added.length, addedIds: added, ok: true as const };
    }),

  /**
   * Create a curated set. Two optional seed sources:
   *   - `frameIds`  — explicit frames (owned by the caller), in input order.
   *   - `fromSetId` — "make a cut": the source set's frames in order
   *                   (references, no copies). The source must be readable by
   *                   the caller (own it, or it's non-private).
   * They're meant to be mutually exclusive; if both are given, `frameIds`
   * wins (the explicit selection is the more specific intent).
   */
  create: protectedProcedure
    .input(
      z.object({
        frameIds: z
          .array(ImageLibraryIdSchema)
          .min(1)
          .max(BATCH_FRAMES_MAX)
          .optional(),
        fromSetId: FrameSetIdSchema.optional(),
        name: z.string().trim().min(1).max(NAME_MAX),
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;

      let seedFrames: { frameId: ImageLibraryId; position: number }[] = [];
      if (input.frameIds) {
        const owned = await requireOwnedFrames(db, userId, input.frameIds);
        seedFrames = owned.map((frameId, i) => ({ frameId, position: i }));
      } else if (input.fromSetId) {
        const source = await loadSet(db, input.fromSetId);
        if (!(source && canRead(source, userId))) {
          throw new ORPCError("NOT_FOUND", { message: "Set not found." });
        }
        const members = await db
          .select({
            frameId: SCHEMA.frameSetFrame.frameId,
            position: SCHEMA.frameSetFrame.position,
          })
          .from(SCHEMA.frameSetFrame)
          .where(eq(SCHEMA.frameSetFrame.setId, input.fromSetId))
          .orderBy(asc(SCHEMA.frameSetFrame.position));
        seedFrames = members.map((m, i) => ({
          frameId: m.frameId,
          position: i,
        }));
      }

      const [row] = await db
        .insert(SCHEMA.frameSet)
        .values({
          frameCount: seedFrames.length,
          name: input.name,
          origin: "curated",
          userId,
        })
        .returning();
      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }
      if (seedFrames.length > 0) {
        await db.insert(SCHEMA.frameSetFrame).values(
          seedFrames.map((f) => ({
            frameId: f.frameId,
            position: f.position,
            setId: row.id,
          }))
        );
      }
      const set = toSummary(
        {
          ...row,
          frameCount: seedFrames.length,
        } as SetRow,
        null
      );
      return { set };
    }),

  /**
   * Full set: header + ordered member frames (fresh read urls). PUBLIC with
   * optional auth — the /s/[id] replay path. Member tMs (the junction's
   * original-timing offset; recordings only) overrides the frame row's own.
   */
  get: publicProcedure
    .input(z.object({ setId: FrameSetIdSchema }))
    .handler(async ({ context, input }): Promise<FrameSet> => {
      const { db } = context;
      const userId = (context.session?.user.id as UserId | undefined) ?? null;
      const set = await loadSet(db, input.setId);
      if (!(set && canRead(set, userId))) {
        throw new ORPCError("NOT_FOUND", { message: "Set not found." });
      }

      const rows = await db
        .select({ ...FRAME_COLUMNS, memberTMs: SCHEMA.frameSetFrame.tMs })
        .from(SCHEMA.frameSetFrame)
        .innerJoin(
          SCHEMA.imageLibrary,
          eq(SCHEMA.frameSetFrame.frameId, SCHEMA.imageLibrary.id)
        )
        .where(eq(SCHEMA.frameSetFrame.setId, input.setId))
        .orderBy(asc(SCHEMA.frameSetFrame.position));

      const frames = rows.map((r) => ({
        ...rowToFrame(r),
        tMs: r.memberTMs ?? 0,
      }));
      let coverUrl: string | null = frames[0]?.url ?? null;
      if (set.coverFrameId) {
        const explicit = frames.find((f) => f.id === set.coverFrameId);
        if (explicit) {
          coverUrl = explicit.url;
        }
      }
      return {
        ...toSummary(set, coverUrl),
        coverFrameId: set.coverFrameId,
        frames,
      };
    }),

  // Public: the /s/[id] permalink resolver. Accepts a set_ id (a recording's
  // set uuid = its lse uuid, so the link exists from the first frame) or a
  // bare lse_ id (anon producers have no recording set — live tense only).
  //
  // Tense rules: a registry hit on the set's liveSessionId → LIVE — readable
  // by anyone holding the id (the link is the capability, same trust model as
  // a stage room code). No registry hit → REPLAY — honors set visibility
  // (owner always; others need non-private). Missing and private-to-others
  // both come back exists:false so a private set's existence doesn't leak.
  // Replay frames are NOT inlined — the page fetches sets.get (same gate).
  lens: publicProcedure
    .input(z.object({ id: z.string().min(8).max(64) }))
    .handler(async ({ context, input }) => {
      let setRow: {
        frameCount: number;
        id: FrameSetId;
        liveSessionId: LiveSessionId | null;
        name: string;
        origin: "builtin" | "recording" | "curated";
        status: "recording" | "final";
        userId: UserId | null;
        visibility: "private" | "unlisted" | "public";
      } | null = null;
      let liveSessionId: string | null = null;

      // A prefix-valid but undecodable suffix makes typeIdToUuid throw (both
      // directly and inside drizzle's typeId toDriver) — on a public endpoint
      // that must read as "not found", never a 500.
      try {
        typeIdToUuid(input.id as FrameSetId);
      } catch {
        return { exists: false as const };
      }

      if (input.id.startsWith("set_")) {
        const [row] = await context.db
          .select({
            frameCount: SCHEMA.frameSet.frameCount,
            id: SCHEMA.frameSet.id,
            liveSessionId: SCHEMA.frameSet.liveSessionId,
            name: SCHEMA.frameSet.name,
            origin: SCHEMA.frameSet.origin,
            status: SCHEMA.frameSet.status,
            userId: SCHEMA.frameSet.userId,
            visibility: SCHEMA.frameSet.visibility,
          })
          .from(SCHEMA.frameSet)
          .where(eq(SCHEMA.frameSet.id, input.id as FrameSetId))
          .limit(1);
        if (row) {
          setRow = row;
          ({ liveSessionId } = row);
        } else {
          // No row yet — recording sets only materialize on the first
          // PERSISTED frame, but a deck-only session shows frames without
          // ever persisting. The set uuid IS the lse uuid by construction,
          // so derive it and let the registry decide: live → watchable now,
          // row appears later if the show generates; not live → not found.
          liveSessionId = typeIdFromUuid(
            "liveSession",
            typeIdToUuid(input.id as FrameSetId).uuid
          );
        }
      } else if (input.id.startsWith("lse_")) {
        liveSessionId = input.id;
      } else {
        return { exists: false as const };
      }

      const callerId = (context.session?.user.id as UserId | undefined) ?? null;
      const set = setRow
        ? {
            frameCount: setRow.frameCount,
            id: setRow.id,
            name: setRow.name,
            origin: setRow.origin,
            status: setRow.status,
            visibility: setRow.visibility,
          }
        : null;

      const session = liveSessionId
        ? context.registry.getByLiveSessionId(liveSessionId)
        : undefined;
      if (session) {
        const snap = session.getControlSnapshot();
        const isOwner =
          callerId !== null && session.userId === typeIdToUuid(callerId).uuid;
        const room = session.stageId
          ? stageRooms.roomForStage(session.stageId)
          : stageRooms.roomFor(liveSessionId as string);
        const binding = room ? stageRooms.resolve(room) : undefined;
        const stageCode = await durableStageCode(context.db, session.stageId);
        return {
          exists: true as const,
          isOwner,
          live: {
            currentFrameUrl: snap.currentFrameUrl,
            currentSource: snap.currentSource,
            jobStatus: snap.jobStatus,
            liveSessionId: snap.liveSessionId,
            nowPlaying: snap.nowPlaying,
            stageCode,
          },
          set,
          stage: room
            ? {
                ...stageState.get(room),
                allowPrompts: binding?.allowPrompts ?? false,
                open: true,
                room,
              }
            : null,
          tense: "live" as const,
        };
      }

      if (!setRow) {
        return { exists: false as const };
      }
      const isOwner = callerId !== null && setRow.userId === callerId;
      if (setRow.visibility === "private" && !isOwner) {
        return { exists: false as const };
      }
      return {
        exists: true as const,
        isOwner,
        live: null,
        set,
        stage: null,
        tense: "replay" as const,
      };
    }),

  /**
   * Everything the caller can play: built-in sets (system, public) plus their
   * own recordings and cuts, newest first. `origin` narrows to one kind.
   * Cursor is the `createdAt` ISO string of the last row of the prior page.
   */
  list: protectedProcedure
    .input(
      z.object({
        cursor: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(LIST_MAX_LIMIT).optional(),
        origin: z.enum(["builtin", "recording", "curated"]).optional(),
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const limit = input.limit ?? LIST_DEFAULT_LIMIT;

      // Unlisted builtins (show-specific decks) are operator-only — without
      // this gate every signed-in user would see them in the list.
      const builtinArm = canSeeUnlistedDecks(context.session.user.email)
        ? eq(SCHEMA.frameSet.origin, "builtin")
        : and(
            eq(SCHEMA.frameSet.origin, "builtin"),
            ne(SCHEMA.frameSet.visibility, "unlisted")
          );
      const conditions = [
        or(eq(SCHEMA.frameSet.userId, userId), builtinArm),
      ];
      if (input.origin) {
        conditions.push(eq(SCHEMA.frameSet.origin, input.origin));
      }
      if (input.cursor) {
        conditions.push(lt(SCHEMA.frameSet.createdAt, new Date(input.cursor)));
      }

      const rows = (await db
        .select(SET_COLUMNS)
        .from(SCHEMA.frameSet)
        .where(and(...conditions))
        .orderBy(desc(SCHEMA.frameSet.createdAt))
        .limit(limit + 1)) as SetRow[];

      const hasMore = rows.length > limit;
      const trimmed = hasMore ? rows.slice(0, limit) : rows;
      const setIds = trimmed.map((r) => r.id);

      // Fallback cover (first member frame per set) — one DISTINCT ON query.
      const firstFrameBySet = new Map<string, string>();
      if (setIds.length > 0) {
        const firstFrames = await db
          .selectDistinctOn([SCHEMA.frameSetFrame.setId], {
            setId: SCHEMA.frameSetFrame.setId,
            url: SCHEMA.imageLibrary.url,
          })
          .from(SCHEMA.frameSetFrame)
          .innerJoin(
            SCHEMA.imageLibrary,
            eq(SCHEMA.frameSetFrame.frameId, SCHEMA.imageLibrary.id)
          )
          .where(inArray(SCHEMA.frameSetFrame.setId, setIds))
          .orderBy(
            asc(SCHEMA.frameSetFrame.setId),
            asc(SCHEMA.frameSetFrame.position)
          );
        for (const f of firstFrames) {
          firstFrameBySet.set(f.setId, f.url);
        }
      }

      // Explicit cover urls (only for sets that set one).
      const coverIds = trimmed
        .map((r) => r.coverFrameId)
        .filter((id): id is ImageLibraryId => id !== null);
      const coverUrlById = new Map<string, string>();
      if (coverIds.length > 0) {
        const coverRows = await db
          .select({ id: SCHEMA.imageLibrary.id, url: SCHEMA.imageLibrary.url })
          .from(SCHEMA.imageLibrary)
          .where(inArray(SCHEMA.imageLibrary.id, coverIds));
        for (const c of coverRows) {
          coverUrlById.set(c.id, c.url);
        }
      }

      const sets: FrameSetSummary[] = trimmed.map((r) => {
        const stored =
          (r.coverFrameId ? coverUrlById.get(r.coverFrameId) : undefined) ??
          firstFrameBySet.get(r.id) ??
          null;
        return toSummary(r, stored ? frameReadUrl(stored) : null);
      });

      const nextCursor = hasMore
        ? (trimmed.at(-1)?.createdAt.toISOString() ?? null)
        : null;
      return { nextCursor, sets };
    }),

  /** Delete a set (cascades membership; underlying frames are untouched). */
  remove: protectedProcedure
    .input(z.object({ setId: FrameSetIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedSet(db, userId, input.setId);
      await db
        .delete(SCHEMA.frameSet)
        .where(eq(SCHEMA.frameSet.id, input.setId));
      return { ok: true as const };
    }),

  /** Remove a frame from a curated set (positions keep a gap; harmless). */
  removeFrame: protectedProcedure
    .input(z.object({ frameId: ImageLibraryIdSchema, setId: FrameSetIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const set = await requireOwnedSet(db, userId, input.setId);
      requireEditableFrameList(set);
      const deleted = await db
        .delete(SCHEMA.frameSetFrame)
        .where(
          and(
            eq(SCHEMA.frameSetFrame.setId, input.setId),
            eq(SCHEMA.frameSetFrame.frameId, input.frameId)
          )
        )
        .returning();
      if (deleted.length > 0) {
        await bumpFrameCount(db, input.setId, -1);
      }
      return { ok: true as const };
    }),

  /**
   * Batch removeFrame: drop many frames from a curated set in one delete
   * (positions keep gaps; harmless). Non-members are silently skipped —
   * idempotent, and the inverse of addFrames for the client's undo toast.
   */
  removeFrames: protectedProcedure
    .input(
      z.object({
        frameIds: z.array(ImageLibraryIdSchema).min(1).max(BATCH_FRAMES_MAX),
        setId: FrameSetIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const set = await requireOwnedSet(db, userId, input.setId);
      requireEditableFrameList(set);
      const deleted = await db
        .delete(SCHEMA.frameSetFrame)
        .where(
          and(
            eq(SCHEMA.frameSetFrame.setId, input.setId),
            inArray(SCHEMA.frameSetFrame.frameId, input.frameIds)
          )
        )
        .returning();
      if (deleted.length > 0) {
        await bumpFrameCount(db, input.setId, -deleted.length);
      }
      return { ok: true as const, removed: deleted.length };
    }),

  /** Rename. Metadata edits stay open on recordings (only the frame list is frozen). */
  rename: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(NAME_MAX),
        setId: FrameSetIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedSet(db, userId, input.setId);
      await db
        .update(SCHEMA.frameSet)
        .set({ name: input.name })
        .where(eq(SCHEMA.frameSet.id, input.setId));
      return { ok: true as const };
    }),

  /**
   * Rewrite the authored order. `orderedFrameIds` must be exactly the set's
   * current members (same multiset). Offset-bump transaction dodges the
   * non-deferrable unique (set_id, position) index.
   */
  reorder: protectedProcedure
    .input(
      z.object({
        orderedFrameIds: z.array(ImageLibraryIdSchema),
        setId: FrameSetIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      const set = await requireOwnedSet(db, userId, input.setId);
      requireEditableFrameList(set);

      const current = await db
        .select({ frameId: SCHEMA.frameSetFrame.frameId })
        .from(SCHEMA.frameSetFrame)
        .where(eq(SCHEMA.frameSetFrame.setId, input.setId));

      const currentSorted = current.map((r) => r.frameId).toSorted();
      const inputSorted = input.orderedFrameIds.toSorted();
      const sameSet =
        currentSorted.length === inputSorted.length &&
        currentSorted.every((id, i) => id === inputSorted[i]);
      if (!sameSet) {
        throw new ORPCError("BAD_REQUEST", {
          message: "orderedFrameIds must match the set's current frames.",
        });
      }

      await db.transaction(async (tx) => {
        for (const [i, frameId] of input.orderedFrameIds.entries()) {
          await tx
            .update(SCHEMA.frameSetFrame)
            .set({ position: i + REORDER_OFFSET })
            .where(
              and(
                eq(SCHEMA.frameSetFrame.setId, input.setId),
                eq(SCHEMA.frameSetFrame.frameId, frameId)
              )
            );
        }
        for (const [i, frameId] of input.orderedFrameIds.entries()) {
          await tx
            .update(SCHEMA.frameSetFrame)
            .set({ position: i })
            .where(
              and(
                eq(SCHEMA.frameSetFrame.setId, input.setId),
                eq(SCHEMA.frameSetFrame.frameId, frameId)
              )
            );
        }
      });
      return { ok: true as const };
    }),

  /** Set (or change) the cover frame. Must be a member of the set. */
  setCover: protectedProcedure
    .input(z.object({ frameId: ImageLibraryIdSchema, setId: FrameSetIdSchema }))
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedSet(db, userId, input.setId);
      const [member] = await db
        .select({ id: SCHEMA.frameSetFrame.id })
        .from(SCHEMA.frameSetFrame)
        .where(
          and(
            eq(SCHEMA.frameSetFrame.setId, input.setId),
            eq(SCHEMA.frameSetFrame.frameId, input.frameId)
          )
        )
        .limit(1);
      if (!member) {
        throw new ORPCError("BAD_REQUEST", {
          message: "That frame is not in this set.",
        });
      }
      await db
        .update(SCHEMA.frameSet)
        .set({ coverFrameId: input.frameId })
        .where(eq(SCHEMA.frameSet.id, input.setId));
      return { ok: true as const };
    }),

  /**
   * Author or clear the set's baked look (preset + intensity + cadence) —
   * applied as a unit when the set is picked, like a deck's DECK_LOOK.
   * Metadata-class edit: allowed on any owned set (recordings included);
   * builtins are system-owned so the ownership check rejects them. Writes
   * validate the preset against VISUAL_PRESET_NAMES; reads stay plain
   * strings so renames degrade instead of breaking.
   */
  setLook: protectedProcedure
    .input(
      z.object({
        look: z
          .object({
            cadence: z.object({
              calm: z.number().int().min(1000).max(30_000),
              loud: z.number().int().min(500).max(30_000),
            }),
            intensity: z.number().min(0).max(1),
            preset: z.enum(VISUAL_PRESET_NAMES),
          })
          .nullable(),
        setId: FrameSetIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedSet(db, userId, input.setId);
      await db
        .update(SCHEMA.frameSet)
        .set({
          lookCadenceCalmMs: input.look?.cadence.calm ?? null,
          lookCadenceLoudMs: input.look?.cadence.loud ?? null,
          lookIntensity: input.look?.intensity ?? null,
          lookPreset: input.look?.preset ?? null,
        })
        .where(eq(SCHEMA.frameSet.id, input.setId));
      return { ok: true as const };
    }),

  /** Who can see this set at /s/<id>: private (owner), unlisted, or public. */
  setVisibility: protectedProcedure
    .input(
      z.object({
        setId: FrameSetIdSchema,
        visibility: FrameSetVisibilitySchema,
      })
    )
    .handler(async ({ context, input }) => {
      const { db, userId } = context;
      await requireOwnedSet(db, userId, input.setId);
      await db
        .update(SCHEMA.frameSet)
        .set({ visibility: input.visibility })
        .where(eq(SCHEMA.frameSet.id, input.setId));
      return { ok: true as const };
    }),
};
