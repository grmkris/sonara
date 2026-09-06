import { ORPCError } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import { typeIdFromUuid } from "@sonara/shared/typeid";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { frameReadUrl } from "./frame-mapping";
import { protectedProcedure } from "./procedures";

const request = z.object({ requestId: z.string().uuid() });

// One explicit image request reuses the durable generation worker, including
// its credit gate, refunds and frame persistence. The request UUID determines
// the job ID, so reconnecting/retrying cannot enqueue another chargeable job.
export const moodRouter = {
  generate: protectedProcedure
    .input(request.extend({ prompt: z.string().trim().min(1).max(2000) }))
    .handler(
      async ({ context, input }) =>
        await context.db.transaction(async (tx) => {
          await tx
            .select({ id: SCHEMA.user.id })
            .from(SCHEMA.user)
            .where(eq(SCHEMA.user.id, context.userId))
            .for("update");
          const id = typeIdFromUuid("generationJob", input.requestId);
          const [existing] = await tx
            .select()
            .from(SCHEMA.generationJob)
            .where(eq(SCHEMA.generationJob.id, id));
          if (existing) {
            if (existing.userId !== context.userId) {
              throw new ORPCError("NOT_FOUND");
            }
            if (existing.description !== input.prompt || existing.total !== 1) {
              throw new ORPCError("BAD_REQUEST", {
                message: "This request already belongs to a different image.",
              });
            }
            return { setId: existing.setId };
          }
          const [active] = await tx
            .select({ id: SCHEMA.generationJob.id })
            .from(SCHEMA.generationJob)
            .where(
              and(
                eq(SCHEMA.generationJob.userId, context.userId),
                inArray(SCHEMA.generationJob.status, ["pending", "running"])
              )
            )
            .limit(1);
          if (active) {
            throw new ORPCError("BAD_REQUEST", {
              message:
                "Your previous images are still being made. Try again when they finish.",
            });
          }
          const setId = typeIdFromUuid("frameSet", input.requestId);
          await tx
            .insert(SCHEMA.frameSet)
            .values({
              id: setId,
              name: input.prompt.slice(0, 120),
              origin: "curated",
              status: "generating",
              userId: context.userId,
              visibility: "private",
            });
          await tx
            .insert(SCHEMA.generationJob)
            .values({
              description: input.prompt,
              id,
              kind: "create",
              prompts: [input.prompt],
              setId,
              styleAnchor: input.prompt,
              total: 1,
              userId: context.userId,
            });
          return { setId };
        })
    ),
  status: protectedProcedure
    .input(request)
    .handler(async ({ context, input }) => {
      const [job] = await context.db
        .select()
        .from(SCHEMA.generationJob)
        .where(
          and(
            eq(
              SCHEMA.generationJob.id,
              typeIdFromUuid("generationJob", input.requestId)
            ),
            eq(SCHEMA.generationJob.userId, context.userId)
          )
        );
      if (!job) {
        throw new ORPCError("NOT_FOUND");
      }
      const [frame] = await context.db
        .select({ url: SCHEMA.imageLibrary.url })
        .from(SCHEMA.frameSetFrame)
        .innerJoin(
          SCHEMA.imageLibrary,
          eq(SCHEMA.frameSetFrame.frameId, SCHEMA.imageLibrary.id)
        )
        .where(eq(SCHEMA.frameSetFrame.setId, job.setId))
        .limit(1);
      return {
        setId: job.setId,
        status: job.status,
        url: frame ? frameReadUrl(frame.url) : null,
      };
    }),
};
