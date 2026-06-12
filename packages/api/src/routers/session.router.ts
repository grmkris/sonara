import { eventIterator, os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import {
  AudioFeatures,
  ClientScenePatch,
  DeckKeySchema,
  ImageAnchor,
  RenderResolutionSchema,
  SonaraSceneState,
  NowPlaying,
  ServerEvent,
  TextModelKeySchema,
} from "@sonara/shared";
import type {
  ImageAnchor as ImageAnchorType,
  RenderResolution,
  TextModelKey,
} from "@sonara/shared";
import { z } from "zod";

import type { SessionSource, SessionSourceState } from "../session-registry";

// Structural interface for a live session. apps/server's Session class
// implements this; the router never imports from apps/server so the package
// stays framework-agnostic and buildable on its own.
export interface SessionLike {
  init(): void;
  applyPatch(patch: ClientScenePatch, origin?: "client" | "voice"): void;
  applyAudio(features: AudioFeatures): void;
  recognize(
    clipBase64: string,
    mimeType: string,
    trigger: "auto" | "manual"
  ): Promise<NowPlaying | null>;
  setSource(source: SessionSourceState): void;
  goLive(prompt: string, seedFrameUrl: string | null): void;
  setImageAnchor(
    input: { url: string } | { clear: true }
  ): void;
  setModel(model: TextModelKey): void;
  setResolution(resolution: RenderResolution): void;
  setCurrentFrame(url: string): void;
  setCurrentSource(source: SessionSource): void;
  // "New set": finalize the current recording segment, start the next run in
  // place. The new id reaches the client via the `run.started` event.
  startNewRun(): string;
  reset(): void;
  subscribe(signal?: AbortSignal): AsyncGenerator<ServerEvent>;
  getSnapshot(): SonaraSceneState;
  getSource(): SessionSourceState;
  getImageAnchor(): ImageAnchorType | null;
}

export interface SessionContext {
  session: SessionLike;
}

const sessionOs = os.$context<SessionContext>();

const HelloInput = z.object({}).optional();

const ScenePatchInput = z.object({
  patch: ClientScenePatch,
});

const AudioFeaturesInput = z.object({
  features: AudioFeatures,
});

const VoicePatchInput = z.object({
  patch: ClientScenePatch,
});

const GoLiveInput = z.object({
  // The scene the user typed to leave the deck and start generating.
  prompt: z.string(),
  // Absolute URL of the deck frame on screen when they went live, used as a
  // one-shot anchor so the first generated frame evolves out of it ("take it
  // from there"). Null skips the handoff and starts text-only.
  seedFrameUrl: z.string().url().nullable(),
});

const SetImageAnchorInput = z.union([
  z.object({ url: z.string().url() }),
  z.object({ clear: z.literal(true) }),
]);

// A/B model + resolution switches. Validated against the shared allowlist so a
// client can never drive an arbitrary fal model id (cost/abuse) — only the
// curated TEXT_MODEL_KEYS / RENDER_RESOLUTIONS flow through.
const SetModelInput = z.object({ model: TextModelKeySchema });
const SetResolutionInput = z.object({ resolution: RenderResolutionSchema });

const RecognizeInput = z.object({
  clipBase64: z.string().min(1).max(400_000),
  durationMs: z.number().int().positive(),
  mimeType: z.string().min(1).max(120),
  trigger: z.enum(["auto", "manual"]),
});

// Deliberately NOT z.string().url(): deck frames are origin-relative paths
// (/library/{deck}/img_*.webp) that only resolve on the web origin, and reel
// frames are presigned S3 URLs — both are opaque strings to the server.
const ReportFrameInput = z.object({
  url: z.string().min(1).max(4096),
});

// Companion of frame.report: WHAT is showing (live / deck / set / idle), not
// just which frame. label is the human name (deck label / set name); setId
// rides along for set playback so viewers can link to the permalink; deck
// carries the key so the server can adopt deck reports into its
// authoritative source state.
const ReportSourceInput = z.object({
  source: z.object({
    deck: DeckKeySchema.optional(),
    kind: z.enum(["live", "deck", "set", "idle"]),
    label: z.string().max(200).nullable(),
    setId: z.string().max(64).optional(),
  }),
});

// The server's authoritative source state, carried in the connect snapshot.
const SourceStateOutput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("live") }),
  z.object({ kind: z.literal("idle") }),
  z.object({ deck: DeckKeySchema, kind: z.literal("deck") }),
  z.object({
    kind: z.literal("set"),
    label: z.string().nullable(),
    setId: z.string(),
  }),
]);

const StateOutput = z.object({
  // Server-authoritative image anchor. Set via setImageAnchor; survives a
  // tab refresh because the live Session keeps it in memory until disconnect.
  imageAnchor: ImageAnchor.nullable(),
  scene: SonaraSceneState,
  // Server-authoritative playback source. Anon sessions are pinned to a
  // random deck source at Session construction; signed-in sessions reflect
  // the last command/report. The client hydrates its source slice from this
  // on every (re)connect — that's what starts the client playback loop.
  source: SourceStateOutput,
});

export const sessionRouter = {
  audioFeatures: sessionOs
    .input(AudioFeaturesInput)
    .handler(({ context, input }) => {
      context.session.applyAudio(input.features);
    }),

  // Long-lived event stream. The client subscribes once per connection and
  // receives every server-initiated event (scene.state, frame.preview /
  // frame.final, job.status, now.playing, preset.suggest, generation.*).
  events: sessionOs
    .output(eventIterator(ServerEvent))
    .handler(async function* events({ context, signal }) {
      for await (const event of context.session.subscribe(signal)) {
        yield event;
      }
    }),

  // Leave the deck and go live. Flips demo off server-side, applies the typed
  // scene, and (if a seed frame is given) seeds the first frame off it as a
  // one-shot anchor before continuing with cheap text frames. Anon is refused
  // (live generation needs credits) — the client gates this too.
  goLive: sessionOs.input(GoLiveInput).handler(({ context, input }) => {
    context.session.goLive(input.prompt, input.seedFrameUrl);
  }),

  hello: sessionOs.input(HelloInput).handler(({ context }) => {
    context.session.init();
  }),

  // "New set" from the attached console — same semantics as control.newSet,
  // over the screen's own socket. No reconnect: the run swaps in place.
  newSet: sessionOs.handler(({ context }) => {
    context.session.startNewRun();
  }),

  recognize: sessionOs
    .input(RecognizeInput)
    .output(NowPlaying.nullable())
    .handler(({ context, input }) =>
      context.session.recognize(input.clipBase64, input.mimeType, input.trigger)
    ),

  // The producer reports the frame actually on its screen, once per keyframe
  // change, in EVERY mode (live / deck / reel). This is the only way the
  // server learns what's showing during client-driven playback, which is what
  // the /control preview and any viewer lens render from. Fire-and-forget.
  reportFrame: sessionOs
    .input(ReportFrameInput)
    .handler(({ context, input }) => {
      context.session.setCurrentFrame(input.url);
    }),

  // The producer reports its current SOURCE (live / deck / set / idle) on
  // every transport switch, same producer-truth contract as reportFrame.
  // Fire-and-forget.
  reportSource: sessionOs
    .input(ReportSourceInput)
    .handler(({ context, input }) => {
      context.session.setCurrentSource(input.source);
    }),

  reset: sessionOs.handler(({ context }) => {
    context.session.reset();
  }),

  scenePatch: sessionOs.input(ScenePatchInput).handler(({ context, input }) => {
    context.session.applyPatch(input.patch, "client");
  }),

  // Image-anchor switch. The browser uploaded an image via the web service's
  // /api/upload/image route and got back a fal-hosted URL; this mutation
  // pins that URL onto the live Session as a one-shot chain seed; fires an
  // immediate triggerAnchor. Pass { clear: true } to remove the anchor.
  // Setting an anchor implicitly clears demo mode (anchor wins).
  setImageAnchor: sessionOs
    .input(SetImageAnchorInput)
    .handler(({ context, input }) => {
      context.session.setImageAnchor(input);
    }),

  // A/B-switch the text-mode image model (realtime lightning-sdxl, or the
  // klein queue baseline). The session fires a frame immediately so the switch
  // is visible at once. Client re-sends its choice on every (re)connect.
  setModel: sessionOs.input(SetModelInput).handler(({ context, input }) => {
    context.session.setModel(input.model);
  }),

  // A/B-switch the render resolution (512² / 768²).
  setResolution: sessionOs
    .input(SetResolutionInput)
    .handler(({ context, input }) => {
      context.session.setResolution(input.resolution);
    }),

  // Current-state snapshot. Idempotent pull used by the client on connect (and
  // on every reconnect) to cover the race where session.init()'s initial
  // publishes land before the events() subscribe has attached. Also useful for
  // post-drift resync later.
  state: sessionOs.output(StateOutput).handler(({ context }) => ({
    imageAnchor: context.session.getImageAnchor(),
    scene: context.session.getSnapshot(),
    source: context.session.getSource(),
  })),

  // Direct field-keyed PTT patch. The client routes each push-to-talk
  // transcript to a specific scene field (subject/environment/mood/palette),
  // so the patch is unambiguous — no LLM disambiguation. origin="voice"
  // gives the lower SEMANTIC_THRESHOLD so single-field changes fire
  // immediately.
  voicePatch: sessionOs.input(VoicePatchInput).handler(({ context, input }) => {
    context.session.applyPatch(input.patch, "voice");
  }),
};

export type SessionRouter = typeof sessionRouter;
export type SessionRouterClient = RouterClient<typeof sessionRouter>;
