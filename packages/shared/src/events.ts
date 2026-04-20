import { z } from "zod";
import { DreamSceneState } from "./scene";
import { AudioFeatures } from "./audio";

// Clients may only patch user-authored fields. version/references are
// server-authoritative and are omitted from the patch payload.
export const ClientScenePatch = DreamSceneState.omit({
  version: true,
  references: true,
}).partial();
export type ClientScenePatch = z.infer<typeof ClientScenePatch>;

export const ClientEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("hello"), sessionId: z.string() }),
  z.object({ type: z.literal("scene.patch"), patch: ClientScenePatch }),
  z.object({ type: z.literal("audio.features"), features: AudioFeatures }),
  z.object({ type: z.literal("generate.commit") }),
  z.object({ type: z.literal("session.reset") }),
  z.object({
    type: z.literal("voice.phrase"),
    text: z.string().min(1).max(200),
  }),
]);

export type ClientEvent = z.infer<typeof ClientEvent>;

export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scene.state"), state: DreamSceneState }),
  z.object({
    type: z.literal("frame.preview"),
    imageUrl: z.string(),
    version: z.number(),
  }),
  z.object({
    type: z.literal("frame.final"),
    imageUrl: z.string(),
    version: z.number(),
  }),
  z.object({
    type: z.literal("job.status"),
    status: z.enum(["idle", "running", "cancelled", "error"]),
    message: z.string().optional(),
    reason: z
      .enum(["pause", "semantic", "section", "periodic", "commit", "voice"])
      .optional(),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
