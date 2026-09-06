import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import type { Database } from "@sonara/db";
import { TakeManifest } from "@sonara/shared";
import { FrameSetIdSchema } from "@sonara/shared/typeid";
import type { FrameSetId, UserId } from "@sonara/shared/typeid";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { isConfigured, presignReadUrl, uploadBytes } from "../storage/bucket";
import { protectedProcedure, publicProcedure } from "./procedures";

const chunkKind = z.enum(["video", "audio", "events", "masks", "images"]);
const MAX_CHUNK = 4 * 1024 * 1024;
const requireTake = async (
  db: Pick<Database, "select">,
  setId: FrameSetId,
  userId: string | null,
  write = false
) => {
  const query = db
    .select({
      clientId: SCHEMA.performanceTake.clientId,
      manifest: SCHEMA.performanceTake.manifest,
      owner: SCHEMA.frameSet.userId,
      status: SCHEMA.frameSet.status,
      visibility: SCHEMA.frameSet.visibility,
    })
    .from(SCHEMA.performanceTake)
    .innerJoin(
      SCHEMA.frameSet,
      eq(SCHEMA.frameSet.id, SCHEMA.performanceTake.setId)
    )
    .where(eq(SCHEMA.performanceTake.setId, setId))
    .limit(1);
  const [row] = await (write ? query.for("update") : query);
  if (
    !row ||
    (row.owner !== userId && (write || row.visibility === "private"))
  ) {
    throw new ORPCError("NOT_FOUND");
  }
  return row;
};

export const takesRouter = {
  begin: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        remix: z.boolean().default(false),
      })
    )
    .handler(async ({ context, input }) => {
      if (!isConfigured()) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Take storage is unavailable. Your local recording is safe.",
        });
      }
      return await context.db.transaction(async (tx) => {
        const [existing] = await tx
          .select({
            setId: SCHEMA.performanceTake.setId,
            userId: SCHEMA.frameSet.userId,
          })
          .from(SCHEMA.performanceTake)
          .innerJoin(
            SCHEMA.frameSet,
            eq(SCHEMA.frameSet.id, SCHEMA.performanceTake.setId)
          )
          .where(eq(SCHEMA.performanceTake.clientId, input.clientId))
          .limit(1);
        if (existing) {
          if (existing.userId !== context.userId) {
            throw new ORPCError("NOT_FOUND");
          }
          return { setId: existing.setId };
        }
        const [set] = await tx
          .insert(SCHEMA.frameSet)
          .values({
            name: input.name,
            origin: input.remix ? "curated" : "recording",
            status: "recording",
            userId: context.userId as UserId,
          })
          .returning();
        if (!set) {
          throw new ORPCError("INTERNAL_SERVER_ERROR");
        }
        await tx
          .insert(SCHEMA.performanceTake)
          .values({ clientId: input.clientId, setId: set.id });
        return { setId: set.id };
      });
    }),
  // Small resumable chunks use the same authenticated origin as RPC. No bucket
  // credentials or client-chosen object keys cross the trust boundary.
  chunk: protectedProcedure
    .input(
      z.object({
        contentType: z.string().max(100),
        data: z.string().max(Math.ceil((MAX_CHUNK * 4) / 3) + 4),
        index: z.number().int().min(0).max(1_000_000),
        kind: chunkKind,
        setId: FrameSetIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await context.db.transaction(async (tx) => {
          const row = await requireTake(tx, input.setId, context.userId, true);
          if (row.status !== "recording") {
            throw new ORPCError("FORBIDDEN", {
              message: "This take is finalized.",
            });
          }
          const bytes = Buffer.from(input.data, "base64");
          if (bytes.length === 0 || bytes.length > MAX_CHUNK) {
            throw new ORPCError("BAD_REQUEST");
          }
          const digest = new Bun.CryptoHasher("sha256")
            .update(bytes)
            .digest("hex");
          const where = and(
            eq(SCHEMA.performanceTakeChunk.setId, input.setId),
            eq(SCHEMA.performanceTakeChunk.kind, input.kind),
            eq(SCHEMA.performanceTakeChunk.index, input.index)
          );
          const [existing] = await tx
            .select()
            .from(SCHEMA.performanceTakeChunk)
            .where(where)
            .limit(1);
          if (existing) {
            if (existing.digest !== digest) {
              throw new ORPCError("BAD_REQUEST", {
                message: "Chunk differs from the saved recording.",
              });
            }
            return { saved: true };
          }
          const key = `takes/${input.setId}/${input.kind}/${input.index}-${digest}`;
          await uploadBytes(key, bytes, input.contentType);
          await tx
            .insert(SCHEMA.performanceTakeChunk)
            .values({
              bytes: bytes.length,
              contentType: input.contentType,
              digest,
              index: input.index,
              key,
              kind: input.kind,
              setId: input.setId,
            })
            .onConflictDoNothing();
          return { saved: true };
        })
    ),
  finalize: protectedProcedure
    .input(
      z.object({
        counts: z.object({
          audio: z.number().int().nonnegative(),
          events: z.number().int().positive(),
          images: z.number().int().nonnegative().default(0),
          masks: z.number().int().nonnegative(),
          video: z.number().int().positive(),
        }),
        manifest: TakeManifest,
        setId: FrameSetIdSchema,
      })
    )
    .handler(
      async ({ context, input }) =>
        await context.db.transaction(async (tx) => {
          const existing = await requireTake(
            tx,
            input.setId,
            context.userId,
            true
          );
          if (existing.clientId !== input.manifest.id) {
            throw new ORPCError("BAD_REQUEST");
          }
          if (existing.status === "final") {
            if (
              JSON.stringify(TakeManifest.parse(existing.manifest)) !==
              JSON.stringify(input.manifest)
            ) {
              throw new ORPCError("FORBIDDEN", {
                message: "Create a remix to change a finished take.",
              });
            }
            return { setId: input.setId };
          }
          const chunks = await tx
            .select({
              index: SCHEMA.performanceTakeChunk.index,
              kind: SCHEMA.performanceTakeChunk.kind,
            })
            .from(SCHEMA.performanceTakeChunk)
            .where(eq(SCHEMA.performanceTakeChunk.setId, input.setId));
          for (const kind of chunkKind.options) {
            const indices = chunks
              .filter((c) => c.kind === kind)
              .map((c) => c.index)
              .toSorted((a, b) => a - b);
            if (
              indices.length !== input.counts[kind] ||
              indices.some((v, i) => v !== i)
            ) {
              throw new ORPCError("BAD_REQUEST", {
                message:
                  "Some recording chunks are still missing. Retry the upload.",
              });
            }
          }
          await tx
            .update(SCHEMA.performanceTake)
            .set({ manifest: input.manifest })
            .where(eq(SCHEMA.performanceTake.setId, input.setId));
          await tx
            .update(SCHEMA.frameSet)
            .set({ status: "final" })
            .where(eq(SCHEMA.frameSet.id, input.setId));
          return { setId: input.setId };
        })
    ),
  get: publicProcedure
    .input(z.object({ setId: FrameSetIdSchema }))
    .handler(async ({ context, input }) => {
      const row = await requireTake(
        context.db,
        input.setId,
        context.session?.user.id ?? null
      );
      const chunks = await context.db
        .select()
        .from(SCHEMA.performanceTakeChunk)
        .where(eq(SCHEMA.performanceTakeChunk.setId, input.setId))
        .orderBy(
          asc(SCHEMA.performanceTakeChunk.kind),
          asc(SCHEMA.performanceTakeChunk.index)
        );
      return {
        chunks: chunks.map((c) => ({
          bytes: c.bytes,
          contentType: c.contentType,
          index: c.index,
          kind: c.kind,
          url: presignReadUrl(c.key),
        })),
        manifest: row.manifest,
      };
    }),
  list: protectedProcedure.handler(
    async ({ context }) =>
      await context.db
        .select({
          createdAt: SCHEMA.frameSet.createdAt,
          manifest: SCHEMA.performanceTake.manifest,
          name: SCHEMA.frameSet.name,
          setId: SCHEMA.frameSet.id,
        })
        .from(SCHEMA.performanceTake)
        .innerJoin(
          SCHEMA.frameSet,
          eq(SCHEMA.frameSet.id, SCHEMA.performanceTake.setId)
        )
        .where(eq(SCHEMA.frameSet.userId, context.userId))
        .orderBy(desc(SCHEMA.frameSet.createdAt))
        .limit(100)
  ),
};
