import { ORPCError } from "@sonara/api/server";
import type { ControllableSession, SessionRegistry } from "@sonara/api/server";
import type { Database } from "@sonara/db";
import type { StageId, UserId } from "@sonara/shared/typeid";

import { getOwnedStage } from "../stage/stage-service";

// Stage-keyed ownership resolve: DB ownership first (the stage row
// must exist and be the caller's — FORBIDDEN otherwise), then liveness (a run
// must currently be in the registry — NOT_FOUND with honest copy otherwise).
// Ownership precedes liveness so probing someone else's stage id never leaks
// whether it is live.
export const resolveOwnedStageRun = async (
  ctx: { db: Database; registry: SessionRegistry },
  userId: UserId,
  stageId: StageId
): Promise<ControllableSession> => {
  await getOwnedStage(ctx.db, userId, stageId);
  const session = ctx.registry.getByStageId(stageId);
  if (!session) {
    throw new ORPCError("NOT_FOUND", {
      message: "That stage isn't live — open its screen on the display first.",
    });
  }
  return session;
};
