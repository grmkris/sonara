import { z } from "zod";
import { DreamSceneState } from "./scene";
import { NowPlaying } from "./now-playing";
import { VISUAL_PRESET_NAMES } from "./visual-presets";

// Clients may only patch user-authored fields. version/references/nowPlaying
// are server-authoritative and are omitted from the patch payload.
export const ClientScenePatch = DreamSceneState.omit({
  version: true,
  references: true,
  nowPlaying: true,
}).partial();
export type ClientScenePatch = z.infer<typeof ClientScenePatch>;

// Server-initiated events yielded by the `session.events` oRPC iterator.
// Every push from server → client flows through this union; per-procedure
// inputs (scenePatch, audioFeatures, voicePhrase, recognize, …) carry the
// client → server side.
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
    // When the frame is part of a morph chain (voice / big-semantic target
    // shift), these describe its position so the client can beat-gate release.
    // Absent = single-frame path (existing behaviour, display immediately).
    chainIndex: z.number().int().nonnegative().optional(),
    chainLength: z.number().int().positive().optional(),
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
  // Song-recognition result. `track: null` means the recognizer had no match
  // (unknown song, silence, too-noisy mic, or API unavailable).
  z.object({
    type: z.literal("now.playing"),
    track: NowPlaying.nullable(),
    source: z.enum(["audd", "cache"]),
    trigger: z.enum(["auto", "manual"]),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
