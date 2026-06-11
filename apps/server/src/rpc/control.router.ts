import { ORPCError } from "@sonara/api/server";
import type { ControllableSession } from "@sonara/api/server";
import { SCHEMA } from "@sonara/db";
import { ClientScenePatch, DeckKeySchema } from "@sonara/shared";
import {
  FrameSetIdSchema,
  LiveSessionIdSchema,
  StageIdSchema,
  typeIdToUuid,
} from "@sonara/shared/typeid";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  createStage,
  findStageByCode,
  listStages,
  renameStage,
} from "../stage/stage-service";
import { resolveOwnedSession } from "./owned-session";
import { resolveOwnedStageRun } from "./owned-stage";
import type { ServerHttpContext } from "./procedures";
import { protectedProcedure, publicProcedure } from "./procedures";

// Operator control plane. A signed-in user drives ONE OF THEIR OWN stages
// from a second device while the screen (the projector machine) keeps owning
// the WebSocket. Every mutation calls the same Session methods the WS
// session.router calls, so the screen's canvas + HUD update for free over its
// existing socket.
//
// Targeting is dual-keyed during the stages rollout: new clients address the
// durable { stageId } (DB-owned identity, registry-resolved liveness); the
// shipped web still addresses { liveSessionId } (registry scan). The legacy
// arm — and liveSessions() — are deleted in the post-W2 cleanup.

const ByLiveSession = z.object({ liveSessionId: LiveSessionIdSchema });
const ByTarget = z.union([z.object({ stageId: StageIdSchema }), ByLiveSession]);

type Target = z.infer<typeof ByTarget>;
type AuthedCtx = ServerHttpContext & {
  userId: NonNullable<ServerHttpContext["userId"]>;
};

const resolveTarget = async (
  context: AuthedCtx,
  input: Target
): Promise<ControllableSession> => {
  if ("stageId" in input) {
    return await resolveOwnedStageRun(
      { db: context.db, registry: context.registry },
      context.userId,
      input.stageId
    );
  }
  return resolveOwnedSession(
    context.registry,
    context.userId,
    input.liveSessionId
  );
};

const ScenePatchInput = ByTarget.and(z.object({ patch: ClientScenePatch }));
const GoLiveInput = ByTarget.and(z.object({ prompt: z.string() }));
const SetDemoModeInput = ByTarget.and(
  z.object({ deck: DeckKeySchema.nullable(), on: z.boolean() })
);
const SetImageAnchorInput = z.union([
  ByTarget.and(
    z.object({ strength: z.number().min(0).max(1), url: z.string().url() })
  ),
  ByTarget.and(z.object({ clear: z.literal(true) })),
]);

// Remote source switch: what the screen should show. "live" isn't a remote
// pick — going live needs a prompt and flows through goLive instead.
const SetSourceInput = z.object({
  source: z.union([
    z.object({
      kind: z.literal("set"),
      label: z.string().max(200).nullable().default(null),
      setId: FrameSetIdSchema,
    }),
    z.object({ deck: DeckKeySchema, kind: z.literal("deck") }),
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

  // LEGACY discovery (pre-stages web) — deleted in the post-W2 cleanup.
  liveSessions: protectedProcedure.handler(({ context }) => {
    const rawUuid = typeIdToUuid(context.userId).uuid;
    const sessions = context.registry
      .listByUserId(rawUuid)
      .map((s) => {
        const snap = s.getControlSnapshot();
        return {
          currentFrameUrl: snap.currentFrameUrl,
          demoDeck: snap.demoDeck,
          demoMode: snap.demoMode,
          jobStatus: snap.jobStatus,
          lastFrameUrl: snap.lastFrameUrl,
          liveSessionId: snap.liveSessionId,
          nowPlaying: snap.nowPlaying,
          prompt: snap.scene.prompt,
          startedAt: snap.startedAt,
        };
      })
      // Newest session first so the projector you just opened leads the list.
      .toSorted((a, b) => b.startedAt - a.startedAt);
    return { sessions };
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

  setDemoMode: protectedProcedure
    .input(SetDemoModeInput)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.setDemoMode(input.on, input.deck);
      // Relay the deck pick to the screen as a source switch — without this a
      // remote console's deck pick only mutates server state and the screen
      // keeps playing the old deck until its next reconnect. HTTP control
      // path only (the screen's own WS picks don't come through here, so no
      // echo). Demo-off stays with the existing stop flow.
      if (input.on && input.deck) {
        session.notifySource({ deck: input.deck, kind: "deck" });
      }
    }),

  setImageAnchor: protectedProcedure
    .input(SetImageAnchorInput)
    .handler(async ({ context, input }) => {
      const session = await resolveTarget(context, input);
      session.setImageAnchor(
        "clear" in input
          ? { clear: true }
          : { strength: input.strength, url: input.url }
      );
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
        session.notifySource({
          kind: "set",
          label: input.source.label ?? set.name,
          setId: input.source.setId,
        });
        return { ok: true };
      }
      if (input.source.kind === "deck") {
        session.notifySource({ deck: input.source.deck, kind: "deck" });
        return { ok: true };
      }
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
                demoDeck: snap.demoDeck,
                demoMode: snap.demoMode,
                jobStatus: snap.jobStatus,
                liveSessionId: snap.liveSessionId,
                nowPlaying: snap.nowPlaying,
                prompt: snap.scene.prompt,
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
