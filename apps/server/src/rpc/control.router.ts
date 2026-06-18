import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import { ClientScenePatch, LookConfig } from "@sonara/shared";
import type { DeckKey } from "@sonara/shared";
import { FrameSetIdSchema, StageIdSchema } from "@sonara/shared/typeid";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createStage,
  findStageByCode,
  listStages,
  renameStage,
} from "../stage/stage-service";
import { resolveOwnedStageRun } from "./owned-stage";
import type { ServerHttpContext } from "./procedures";
import { protectedProcedure, publicProcedure } from "./procedures";

// Operator control plane. A signed-in user drives ONE OF THEIR OWN stages
// from a second device while the screen (the projector machine) keeps owning
// the WebSocket. Every mutation calls the same Session methods the WS
// session.router calls, so the screen's canvas + HUD update for free over its
// existing socket.
//
// Targeting is stage-keyed: clients address the durable { stageId } (DB-owned
// identity, registry-resolved liveness).

const ByTarget = z.object({ stageId: StageIdSchema });

type Target = z.infer<typeof ByTarget>;
type AuthedCtx = ServerHttpContext & {
  userId: NonNullable<ServerHttpContext["userId"]>;
};

const resolveTarget = async (
  context: AuthedCtx,
  input: Target
): Promise<ControllableSession> =>
  await resolveOwnedStageRun(
    { db: context.db, registry: context.registry },
    context.userId,
    input.stageId
  );

const ScenePatchInput = ByTarget.and(z.object({ patch: ClientScenePatch }));
const GoLiveInput = ByTarget.and(z.object({ prompt: z.string() }));
const SetImageAnchorInput = z.union([
  ByTarget.and(z.object({ url: z.string().url() })),
  ByTarget.and(z.object({ clear: z.literal(true) })),
]);

// Remote source switch: what the screen should show. "live" isn't a remote
// pick — going live needs a prompt and flows through goLive instead. setId is
// REQUIRED here: remote picks always originate from fetched sets.list rows
// (client-native deckKey-only sources exist only on the producing device).
const SetSourceInput = z.object({
  source: z.union([
    z.object({
      kind: z.literal("set"),
      label: z.string().max(200).nullable().default(null),
      setId: FrameSetIdSchema,
    }),
    z.object({ kind: z.literal("idle") }),
  ]),
  stageId: StageIdSchema,
});

export const controlRouter = {
  createStage: protectedProcedure
    .input(z.object({ name: z.string().trim().min(1).max(60) }))
    .handler(async ({ context, input }) => ({
      stage: await createStage(context.db, context.userId, input.name),
    })),

  // The operator has no canvas, so there's no on-screen deck frame to hand off
  // from — seed from the server's last final frame if there is one, else start
  // text-only.
  goLive: protectedProcedure
    .input(GoLiveInput)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.goLive(input.prompt, session.getControlSnapshot().lastFrameUrl);
    }),

  // "New set": finalize the current recording segment, start the next one on
  // the same run — the screen learns the new id via `run.started`.
  newSet: protectedProcedure
    .input(z.object({ stageId: StageIdSchema }))
    .handler(async ({ context, input }) => {
      const session = await resolveOwnedStageRun(
        { db: context.db, registry: context.registry },
        context.userId,
        input.stageId
      );
      return { liveSessionId: session.startNewRun() };
    }),

  renameStage: protectedProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(60),
        stageId: StageIdSchema,
      })
    )
    .handler(async ({ context, input }) => {
      await renameStage(context.db, context.userId, input.stageId, input.name);
      return { ok: true };
    }),

  reset: protectedProcedure
    .input(ByTarget)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.reset();
    }),

  // Public code → stage gate for the face routes (/stage/<code>/screen and
  // /console). Owner-only facts are gated on the caller; liveness is safe to
  // expose (the crowd page implies it anyway).
  resolveStage: publicProcedure
    .input(z.object({ code: z.string().trim().min(3).max(12) }))
    .handler(async ({ context, input }) => {
      const stage = await findStageByCode(context.db, input.code);
      if (!stage) {
        return { stage: null };
      }
      return {
        stage: {
          code: stage.code,
          isOwner: context.userId === stage.userId,
          live: context.registry.getByStageId(stage.id) !== undefined,
          name: stage.name,
          screenAttached: context.registry.screenAttached(stage.id),
          stageId: stage.id,
        },
      };
    }),

  scenePatch: protectedProcedure
    .input(ScenePatchInput)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.applyPatch(input.patch, "client");
    }),

  setImageAnchor: protectedProcedure
    .input(SetImageAnchorInput)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.setImageAnchor(
        "clear" in input
          ? { clear: true }
          : { url: input.url }
      );
    }),

  // Relay a render-look change from the console to the screen. The console
  // computes the resolved look (preset + Feel params) and ships it; the screen
  // applies it as the active custom look (look.set → applyLookConfig).
  setLook: protectedProcedure
    .input(z.object({ config: LookConfig, stageId: StageIdSchema }))
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.notifyLook(input.config);
      return { ok: true };
    }),

  // Push a source switch to the screen (e.g. /studio "activate on <stage>").
  // For sets, readability is enforced here (owner, or any non-private set);
  // the screen then fetches frames through the same public sets.get gate.
  setSource: protectedProcedure
    .input(SetSourceInput)
    .handler(async ({ context, input }) => {
      const session = await resolveOwnedStageRun(
        { db: context.db, registry: context.registry },
        context.userId,
        input.stageId
      );
      if (input.source.kind === "set") {
        const rows = await context.db
          .select({
            deckKey: SCHEMA.frameSet.deckKey,
            name: SCHEMA.frameSet.name,
            userId: SCHEMA.frameSet.userId,
            visibility: SCHEMA.frameSet.visibility,
          })
          .from(SCHEMA.frameSet)
          .where(eq(SCHEMA.frameSet.id, input.source.setId))
          .limit(1);
        const [set] = rows;
        if (
          !set ||
          (set.visibility === "private" && set.userId !== context.userId)
        ) {
          throw new ORPCError("NOT_FOUND", { message: "Unknown set." });
        }
        // Optimistic server state first (so trigger() stops generating at
        // once), then the relay; the screen's source.report confirms or
        // corrects within one switch. deckKey rides along so the screen
        // plays builtin sets manifest-direct (no fetch — the offline path).
        const label = input.source.label ?? set.name;
        // The deck_key column is plain text; builtin rows only ever hold
        // DeckKey values (boot converger writes them from DECKS).
        const deckKey = (set.deckKey as DeckKey | null) ?? null;
        session.setSource({
          deckKey,
          kind: "set",
          label,
          setId: input.source.setId,
        });
        session.notifySource({
          deckKey: deckKey ?? undefined,
          kind: "set",
          label,
          setId: input.source.setId,
        });
        return { ok: true };
      }
      session.setSource({ kind: "idle" });
      session.notifySource({ kind: "idle" });
      return { ok: true };
    }),

  // Full snapshot of one owned live run. Polled (~1s) by the operator UI to
  // hydrate the same zustand store the WS path feeds.
  snapshot: protectedProcedure
    .input(ByTarget)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      return session.getControlSnapshot();
    }),

  // The caller's stages (DB rows are the spine — opening /control never
  // creates anything), decorated with registry liveness. Default stage first.
  stages: protectedProcedure.handler(async ({ context }) => {
    const rows = await listStages(context.db, context.userId);
    const stages = rows
      .map((stage) => {
        const run = context.registry.getByStageId(stage.id);
        const snap = run?.getControlSnapshot();
        return {
          code: stage.code,
          isDefault: stage.isDefault,
          live: run !== undefined,
          name: stage.name,
          run: snap
            ? {
                currentFrameUrl: snap.currentFrameUrl,
                jobStatus: snap.jobStatus,
                liveSessionId: snap.liveSessionId,
                nowPlaying: snap.nowPlaying,
                prompt: snap.scene.prompt,
                source: snap.source,
                startedAt: snap.startedAt,
              }
            : null,
          screenAttached: context.registry.screenAttached(stage.id),
          stageId: stage.id,
        };
      })
      .toSorted((a, b) => Number(b.isDefault) - Number(a.isDefault));
    return { stages };
  }),
};
