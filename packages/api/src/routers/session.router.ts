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
  DeckKey,
  ImageAnchor as ImageAnchorType,
  RenderResolution,
  TextModelKey,
} from "@sonara/shared";
import { z } from "zod";

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
  setDemoMode(on: boolean, deck: DeckKey | null): void;
  goLive(prompt: string, seedFrameUrl: string | null): void;
  setImageAnchor(
    input: { url: string; strength: number } | { clear: true }
  ): void;
  setModel(model: TextModelKey): void;
  setResolution(resolution: RenderResolution): void;
  setCurrentFrame(url: string): void;
  reset(): void;
  subscribe(signal?: AbortSignal): AsyncGenerator<ServerEvent>;
  getSnapshot(): SonaraSceneState;
  isDemoMode(): boolean;
  getDemoDeck(): DeckKey | null;
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

const DemoModeInput = z.object({
  deck: DeckKeySchema.nullable(),
  on: z.boolean(),
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
  z.object({
    strength: z.number().min(0).max(1),
    url: z.string().url(),
  }),
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

const StateOutput = z.object({
  demoDeck: DeckKeySchema.nullable(),
  // Server-authoritative demo state. Anon sessions are pinned to demoMode=true
  // at Session construction with a random deck; signed-in sessions reflect
  // whatever the user last toggled. The client hydrates the zustand demo
  // slice from this on every (re)connect — that's what starts the client-native
  // demo loop (use-demo-frame-loop) for the right deck.
  demoMode: z.boolean(),
  // Server-authoritative image anchor. Set via setImageAnchor; survives a
  // tab refresh because the live Session keeps it in memory until disconnect.
  imageAnchor: ImageAnchor.nullable(),
  scene: SonaraSceneState,
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

  reset: sessionOs.handler(({ context }) => {
    context.session.reset();
  }),

  scenePatch: sessionOs.input(ScenePatchInput).handler(({ context, input }) => {
    context.session.applyPatch(input.patch, "client");
  }),

  // DEMO mode switch. When on with a deck selected, the session pulls
  // pre-generated images from image_library instead of calling fal. Toggling
  // off resumes the standard fal path on the next trigger.
  setDemoMode: sessionOs.input(DemoModeInput).handler(({ context, input }) => {
    context.session.setDemoMode(input.on, input.deck);
  }),

  // Image-anchor switch. The browser uploaded an image via the web service's
  // /api/upload/image route and got back a fal-hosted URL; this mutation
  // pins that URL + strength preset onto the live Session, which fires an
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
    demoDeck: context.session.getDemoDeck(),
    demoMode: context.session.isDemoMode(),
    imageAnchor: context.session.getImageAnchor(),
    scene: context.session.getSnapshot(),
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
