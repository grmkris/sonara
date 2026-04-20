import { z } from "zod";
import { DreamSceneState } from "./scene";
import { AudioFeatures } from "./audio";
import { VISUAL_PRESET_NAMES } from "./visual-presets";

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
  // Voice-originated reset goes through a client confirm toast before the
  // destructive session.reset actually runs — mishears are a real risk.
  z.object({
    type: z.literal("confirm.reset"),
    ttlMs: z.number().int().positive(),
    reason: z.string(),
  }),
  // Advisory visual-preset suggestion from the server-side LLM. The client
  // only applies it when presetMode === "llm".
  z.object({
    type: z.literal("preset.suggest"),
    name: z.enum(VISUAL_PRESET_NAMES),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
