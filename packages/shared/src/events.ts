import { z } from "zod";

import { InspectorContextSchema } from "./inspector-context";
import { NowPlaying } from "./now-playing";
import { SonaraSceneState } from "./scene";
import { ResolvedScene } from "./scene-resolved";
import { ImageLibraryIdSchema, LiveSessionIdSchema, ReelIdSchema } from "./typeid";
import { VISUAL_PRESET_NAMES } from "./visual-presets";

// One persisted generated frame. Returned by the library router (list /
// bySession RPCs) and carried by the `library.appended` WS event. The `url`
// field is a fresh presigned read URL — never store these long-term on the
// client; refetch via library.list to get current URLs.
//
// The `triggerReason`/`anchorUrl`/`inspectorContext` fields are populated
// for frames generated after Phase 8a; historical rows have null/undefined
// there. The /studio inspector renders "no context recorded" for null
// inspectorContext rows.
export const LibraryFrameSchema = z.object({
  anchorUrl: z.string().nullable().optional(),
  createdAt: z.coerce.date(),
  deck: z.string(),
  height: z.number().int().positive(),
  id: ImageLibraryIdSchema,
  inspectorContext: InspectorContextSchema.nullable().optional(),
  palette: z.array(z.string()).nullable(),
  prompt: z.string(),
  sessionId: LiveSessionIdSchema,
  tMs: z.number().int().nonnegative(),
  triggerReason: z.string().nullable().optional(),
  url: z.string(),
  width: z.number().int().positive(),
});

export type LibraryFrame = z.infer<typeof LibraryFrameSchema>;

// Session-level summary returned by library.sessions. Lightweight — no
// per-frame data, just the aggregate + a representative sample URL for
// the sessions sidebar in /studio.
export const SessionSummarySchema = z.object({
  // Total session duration in ms (lastFrameAt - firstFrameAt). Cheap to
  // compute server-side; clients avoid a Date math step.
  durationMs: z.number().int().nonnegative(),
  firstFrameAt: z.coerce.date(),
  frameCount: z.number().int().nonnegative(),
  lastFrameAt: z.coerce.date(),
  // Presigned URL of the newest frame in the session — used as the
  // sidebar thumbnail. Null only if the session has no rows (defensive).
  sampleUrl: z.string().nullable(),
  sessionId: LiveSessionIdSchema,
});

export type SessionSummary = z.infer<typeof SessionSummarySchema>;

// Lightweight summary for the /studio reels sidebar — no per-frame data, just
// the aggregate + a presigned cover thumbnail. Reels are user-curated groups
// of frames (see packages/db/src/schema/reel.db.ts).
export const ReelSummarySchema = z.object({
  // Presigned URL of the cover frame (explicit cover, else newest member).
  // Null when the reel is still empty.
  coverUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  frameCount: z.number().int().nonnegative(),
  id: ReelIdSchema,
  name: z.string(),
});

export type ReelSummary = z.infer<typeof ReelSummarySchema>;

// A full reel: summary header + its ordered frames (reusing LibraryFrame, with
// freshly presigned urls). Frames are ordered by reel_frame.position.
export const ReelSchema = z.object({
  coverUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  frames: z.array(LibraryFrameSchema),
  id: ReelIdSchema,
  name: z.string(),
});

export type Reel = z.infer<typeof ReelSchema>;

// Clients may only patch user-authored fields. version/nowPlaying are
// server-authoritative; imageAnchor goes through its dedicated mutation
// (setImageAnchor) — none of them belong in a scene.patch payload.
export const ClientScenePatch = SonaraSceneState.omit({
  imageAnchor: true,
  nowPlaying: true,
  version: true,
}).partial();
export type ClientScenePatch = z.infer<typeof ClientScenePatch>;

// Server-initiated events yielded by the `session.events` oRPC iterator.
// Every push from server → client flows through this union; per-procedure
// inputs (scenePatch, voicePatch, audioFeatures, recognize, …) carry the
// client → server side.
export const ServerEvent = z.discriminatedUnion("type", [
  z.object({ state: SonaraSceneState, type: z.literal("scene.state") }),
  z.object({
    imageUrl: z.string(),
    type: z.literal("frame.preview"),
    version: z.number(),
  }),
  z.object({
    // Optional during rollout — older server builds emit without these.
    // frameId + tMs let the client match this final to a library row
    // appended via `library.appended`, so the timeline can highlight the
    // currently-playing frame.
    frameId: ImageLibraryIdSchema.optional(),
    imageUrl: z.string(),
    tMs: z.number().int().nonnegative().optional(),
    type: z.literal("frame.final"),
    version: z.number(),
  }),
  z.object({
    message: z.string().optional(),
    reason: z
      .enum(["pause", "semantic", "section", "periodic", "voice"])
      .optional(),
    status: z.enum(["idle", "running", "cancelled", "error"]),
    type: z.literal("job.status"),
  }),
  // Advisory visual-preset suggestion from the server-side LLM. The client
  // only applies it when presetMode === "llm".
  z.object({
    name: z.enum(VISUAL_PRESET_NAMES),
    type: z.literal("preset.suggest"),
  }),
  // Song-recognition result. `track: null` means the recognizer had no match.
  z.object({
    source: z.enum(["audd", "cache"]),
    track: NowPlaying.nullable(),
    trigger: z.enum(["auto", "manual"]),
    type: z.literal("now.playing"),
  }),
  // Generation-pipeline observability. Emitted around every trigger() so the
  // inspector HUD can show what scene + prompt the model received and how
  // long the call took.
  z.object({
    driftSource: z.enum(["pool", "none"]),
    nextKeyframeAt: z.number(),
    promptString: z.string(),
    reason: z.enum(["pause", "semantic", "section", "periodic", "voice"]),
    requestedAt: z.number(),
    resolvedScene: ResolvedScene,
    type: z.literal("generation.requested"),
    version: z.number().int().positive(),
  }),
  z.object({
    durationMs: z.number().nonnegative(),
    message: z.string().optional(),
    success: z.boolean(),
    type: z.literal("generation.completed"),
    version: z.number().int().positive(),
  }),
  // Emitted after a generated frame is persisted to the bucket + DB. The
  // client's library slice appends this to its timeline. Only fires for
  // authed sessions and only when storage is configured; anon sessions
  // and bucket-misconfigured dev never see it.
  z.object({
    frame: LibraryFrameSchema,
    type: z.literal("library.appended"),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
