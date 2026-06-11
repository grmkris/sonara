import { z } from "zod";

import { InspectorContextSchema } from "./inspector-context";
import { NowPlaying } from "./now-playing";
import { SonaraSceneState } from "./scene";
import { ResolvedScene } from "./scene-resolved";
import {
  FrameSetIdSchema,
  ImageLibraryIdSchema,
  LiveSessionIdSchema,
} from "./typeid";
import { VISUAL_PRESET_NAMES } from "./visual-presets";

// One persisted generated frame. Returned by the library/sets routers and
// carried by the `library.appended` WS event. The `url` field is a fresh
// presigned read URL — never store these long-term on the client; refetch
// via library.list to get current URLs.
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

// --- Sets (frame_set): the unified playable frame collection. Subsumes
// built-in decks (origin=builtin), session recordings (origin=recording) and
// curated reels (origin=curated). See packages/db/src/schema/frame-set.db.ts.

export const FrameSetOriginSchema = z.enum([
  "builtin",
  "recording",
  "curated",
]);
export type FrameSetOrigin = z.infer<typeof FrameSetOriginSchema>;

export const FrameSetVisibilitySchema = z.enum([
  "private",
  "unlisted",
  "public",
]);
export type FrameSetVisibility = z.infer<typeof FrameSetVisibilitySchema>;

// A set's optional baked look — render preset + reactivity intensity +
// cadence bounds, applied as a unit when the set is picked (generalizes the
// deck-only DECK_LOOK). `preset` is a plain string on the read side so a
// renamed preset degrades (client guards with isKnownPreset) instead of
// breaking every set read; writes validate against VISUAL_PRESET_NAMES in
// sets.setLook.
export const SetLookSchema = z.object({
  cadence: z.object({
    calm: z.number().int().positive(),
    loud: z.number().int().positive(),
  }),
  intensity: z.number().min(0).max(1),
  preset: z.string(),
});
export type SetLook = z.infer<typeof SetLookSchema>;

// Lightweight summary for set lists (studio sidebar, the Now-Showing
// dropdown). No per-frame data — just the aggregate + a presigned cover.
export const FrameSetSummarySchema = z.object({
  // Presigned URL of the cover frame (explicit cover, else first member).
  // Null when the set is still empty.
  coverUrl: z.string().nullable(),
  createdAt: z.coerce.date(),
  // Builtin sets only: the DeckKey whose static manifest still drives
  // playback client-side.
  deckKey: z.string().nullable(),
  frameCount: z.number().int().nonnegative(),
  id: FrameSetIdSchema,
  // Recordings only: the live session that produced (or is producing) it.
  liveSessionId: LiveSessionIdSchema.nullable(),
  // Authored look, or null. Applied on pick like a deck's DECK_LOOK.
  look: SetLookSchema.nullable(),
  name: z.string(),
  origin: FrameSetOriginSchema,
  // recording = a live performance is still appending frames.
  status: z.enum(["recording", "final"]),
  // Prompt-drift modifier for live generation after leaving this set.
  styleDrift: z.string().nullable(),
  visibility: FrameSetVisibilitySchema,
});
export type FrameSetSummary = z.infer<typeof FrameSetSummarySchema>;

// A full set: summary header + ordered member frames (freshly presigned
// urls, ordered by frame_set_frame.position). Member tMs (original replay
// timing, recordings only) rides on LibraryFrame.tMs.
export const FrameSetSchema = FrameSetSummarySchema.extend({
  coverFrameId: ImageLibraryIdSchema.nullable(),
  frames: z.array(LibraryFrameSchema),
});
export type FrameSet = z.infer<typeof FrameSetSchema>;

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
  // Monad stage lifecycle for THIS session: emitted when the owner opens or
  // closes the crowd stage (control.openStage/closeStage) and on (re)connect
  // while a room is open. `room: null` means no stage. The projector uses it
  // to dial the public /ws/stage feed for its wire overlay.
  z.object({
    allowPrompts: z.boolean().optional(),
    room: z.string().nullable(),
    // Projector join-QR overlay, host-toggled from /control. Defaults shown.
    showQr: z.boolean().optional(),
    type: z.literal("stage.status"),
  }),
  // The server-owned run identity for this connection — emitted on every
  // (re)connect init and again when a new run starts ("new set" / setSource).
  // The client derives the recording set's permalink from it (set uuid = lse
  // uuid) instead of minting ids locally.
  z.object({
    liveSessionId: z.string(),
    type: z.literal("run.started"),
  }),
  // A second screen attached to this stage and took over as producer. Rides
  // the shared session publisher, so BOTH screens see it: the one whose
  // connection id matches demotes itself to a passive notice; the new screen
  // ignores it. The kicked socket is also closed with code 4409.
  z.object({
    connectionId: z.string(),
    type: z.literal("screen.takenOver"),
  }),
  // Remote source switch (control.setSource — e.g. /studio "activate on
  // <stage>"). The server is a relay: the SCREEN starts the playback exactly
  // like a local pick, then reports back via source.report — currentSource
  // stays producer-truth, never optimistic.
  z.object({
    source: z.object({
      deck: z.string().optional(),
      kind: z.enum(["set", "deck", "idle"]),
      label: z.string().nullable().optional(),
      setId: z.string().optional(),
    }),
    type: z.literal("source.set"),
  }),
]);

export type ServerEvent = z.infer<typeof ServerEvent>;
