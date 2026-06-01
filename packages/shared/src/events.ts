import { z } from "zod";
import { SonaraSceneState } from "./scene";
import { NowPlaying } from "./now-playing";
import { ResolvedScene } from "./scene-resolved";
import { ImageLibraryIdSchema, LiveSessionIdSchema } from "./typeid";
import { VISUAL_PRESET_NAMES } from "./visual-presets";

// One persisted generated frame. Returned by the library router (list /
// bySession RPCs) and carried by the `library.appended` WS event. The `url`
// field is a fresh presigned read URL — never store these long-term on the
// client; refetch via library.list to get current URLs.
export const LibraryFrameSchema = z.object({
  id: ImageLibraryIdSchema,
  url: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  palette: z.array(z.string()).nullable(),
  deck: z.string(),
  prompt: z.string(),
  tMs: z.number().int().nonnegative(),
  sessionId: LiveSessionIdSchema,
  createdAt: z.coerce.date(),
});

export type LibraryFrame = z.infer<typeof LibraryFrameSchema>;

// Clients may only patch user-authored fields. version/nowPlaying are
// server-authoritative; imageAnchor goes through its dedicated mutation
// (setImageAnchor) — none of them belong in a scene.patch payload.
export const ClientScenePatch = SonaraSceneState.omit({
  version: true,
  imageAnchor: true,
  nowPlaying: true,
}).partial();
export type ClientScenePatch = z.infer<typeof ClientScenePatch>;

// Server-initiated events yielded by the `session.events` oRPC iterator.
// Every push from server → client flows through this union; per-procedure
// inputs (scenePatch, voicePatch, audioFeatures, recognize, …) carry the
// client → server side.
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("scene.state"), state: SonaraSceneState }),
  z.object({
    type: z.literal("frame.preview"),
    imageUrl: z.string(),
    version: z.number(),
  }),
  z.object({
    type: z.literal("frame.final"),
    imageUrl: z.string(),
    version: z.number(),
    // Optional during rollout — older server builds emit without these.
    // frameId + tMs let the client match this final to a library row
    // appended via `library.appended`, so the timeline can highlight the
    // currently-playing frame.
    frameId: ImageLibraryIdSchema.optional(),
    tMs: z.number().int().nonnegative().optional(),
  }),
  z.object({
    type: z.literal("job.status"),
    status: z.enum(["idle", "running", "cancelled", "error"]),
    message: z.string().optional(),
    reason: z
      .enum(["pause", "semantic", "section", "periodic", "voice"])
      .optional(),
  }),
  // Advisory visual-preset suggestion from the server-side LLM. The client
  // only applies it when presetMode === "llm".
  z.object({
    type: z.literal("preset.suggest"),
    name: z.enum(VISUAL_PRESET_NAMES),
  }),
  // Song-recognition result. `track: null` means the recognizer had no match.
  z.object({
    type: z.literal("now.playing"),
    track: NowPlaying.nullable(),
    source: z.enum(["audd", "cache"]),
    trigger: z.enum(["auto", "manual"]),
  }),
  // Generation-pipeline observability. Emitted around every trigger() so the
  // inspector HUD can show what scene + prompt the model received and how
  // long the call took.
  z.object({
    type: z.literal("generation.requested"),
    reason: z.enum(["pause", "semantic", "section", "periodic", "voice"]),
    version: z.number().int().positive(),
    promptString: z.string(),
    driftSource: z.enum(["pool", "none"]),
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
  // Emitted after a generated frame is persisted to the bucket + DB. The
  // client's library slice appends this to its timeline. Only fires for
  // authed sessions and only when storage is configured; anon sessions
  // and bucket-misconfigured dev never see it.
  z.object({
    type: z.literal("library.appended"),
    frame: LibraryFrameSchema,
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
