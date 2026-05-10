import { z } from "zod";
import { DreamSceneState } from "./scene";
import { NowPlaying } from "./now-playing";
import { ResolvedScene } from "./scene-resolved";
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
  // Voice transparency stream. Three stages:
  //   voice.partial → live transcript from the browser's Web Speech API
  //                   (interim + final). UI shows what was heard.
  //   voice.parsed  → LLM intent JSON + latency. UI shows what was understood.
  //   voice.applied → diff vs prior scene + optional generationVersion. UI
  //                   shows what actually changed and whether a generation
  //                   was queued. phraseId correlates the three stages so the
  //                   trail UI can advance from one to the next.
  z.object({
    type: z.literal("voice.partial"),
    phraseId: z.number().int().nonnegative(),
    text: z.string(),
    isFinal: z.boolean(),
    confidence: z.number().min(0).max(1).optional(),
    provider: z.enum(["web-speech"]),
  }),
  z.object({
    type: z.literal("voice.parsed"),
    phraseId: z.number().int().nonnegative(),
    intent: z.object({
      patch: z.record(z.string(), z.unknown()),
      commit: z.boolean(),
      reset: z.boolean(),
      preset: z.string().nullable(),
      lookPreset: z.string().nullable(),
      atmosphere: z.string().nullable(),
    }),
    latencyMs: z.number().nonnegative(),
  }),
  z.object({
    type: z.literal("voice.applied"),
    phraseId: z.number().int().nonnegative(),
    patch: z.record(z.string(), z.unknown()),
    triggered: z.boolean(),
    triggeredVersion: z.number().int().positive().optional(),
  }),
  // Generation-pipeline observability. Emitted around every trigger() so the
  // inspector HUD can show what scene + prompt the model received and how
  // long the call took. Phase 2 ships these alongside `job.status`; phase 6
  // makes them the primary signal once trigger-log is replaced.
  z.object({
    type: z.literal("generation.requested"),
    reason: z.enum(["pause", "semantic", "section", "periodic", "commit", "voice"]),
    version: z.number().int().positive(),
    promptString: z.string(),
    driftSource: z.enum(["llm", "voice", "pool", "none"]),
    resolvedScene: ResolvedScene,
    requestedAt: z.number(),
    nextKeyframeAt: z.number(),
  }),
  z.object({
    type: z.literal("generation.completed"),
    version: z.number().int().positive(),
    durationMs: z.number().nonnegative(),
    success: z.boolean(),
    message: z.string().optional(),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
