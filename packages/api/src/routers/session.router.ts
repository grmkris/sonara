import { eventIterator, os } from "@orpc/server";
import type { RouterClient } from "@orpc/server";
import { z } from "zod";
import {
  AudioFeatures,
  ClientScenePatch,
  DreamSceneState,
  NowPlaying,
  ServerEvent,
} from "@music-visualizer/shared";

// Structural interface for a live session. apps/server's Session class
// implements this; the router never imports from apps/server so the package
// stays framework-agnostic and buildable on its own.
export interface SessionLike {
  init(opts?: { falKey?: string }): void;
  applyPatch(patch: ClientScenePatch, origin?: "client" | "voice"): void;
  applyAudio(features: AudioFeatures): void;
  recognize(
    clipBase64: string,
    mimeType: string,
    trigger: "auto" | "manual",
  ): Promise<NowPlaying | null>;
  reset(): void;
  subscribe(signal?: AbortSignal): AsyncGenerator<ServerEvent>;
  getSnapshot(): DreamSceneState;
}

export interface SessionContext {
  session: SessionLike;
}

const sessionOs = os.$context<SessionContext>();

const HelloInput = z.object({
  falKey: z.string().min(1).optional(),
});

const ScenePatchInput = z.object({
  patch: ClientScenePatch,
});

const AudioFeaturesInput = z.object({
  features: AudioFeatures,
});

const VoicePatchInput = z.object({
  patch: ClientScenePatch,
});

const RecognizeInput = z.object({
  clipBase64: z.string().min(1).max(400_000),
  mimeType: z.string().min(1).max(120),
  durationMs: z.number().int().positive(),
  trigger: z.enum(["auto", "manual"]),
});

const StateOutput = z.object({
  scene: DreamSceneState,
});

export const sessionRouter = {
  // Long-lived event stream. The client subscribes once per connection and
  // receives every server-initiated event (scene.state, frame.preview /
  // frame.final, job.status, now.playing, preset.suggest, generation.*).
  events: sessionOs
    .output(eventIterator(ServerEvent))
    .handler(async function* ({ context, signal }) {
      for await (const event of context.session.subscribe(signal)) {
        yield event;
      }
    }),

  hello: sessionOs.input(HelloInput).handler(({ context, input }) => {
    context.session.init(input.falKey ? { falKey: input.falKey } : undefined);
  }),

  scenePatch: sessionOs
    .input(ScenePatchInput)
    .handler(({ context, input }) => {
      context.session.applyPatch(input.patch, "client");
    }),

  audioFeatures: sessionOs
    .input(AudioFeaturesInput)
    .handler(({ context, input }) => {
      context.session.applyAudio(input.features);
    }),

  // Direct field-keyed PTT patch. The client routes each push-to-talk
  // transcript to a specific scene field (subject/environment/mood/palette),
  // so the patch is unambiguous — no LLM disambiguation. origin="voice"
  // gives the lower SEMANTIC_THRESHOLD so single-field changes fire
  // immediately.
  voicePatch: sessionOs
    .input(VoicePatchInput)
    .handler(({ context, input }) => {
      context.session.applyPatch(input.patch, "voice");
    }),

  recognize: sessionOs
    .input(RecognizeInput)
    .output(NowPlaying.nullable())
    .handler(({ context, input }) =>
      context.session.recognize(
        input.clipBase64,
        input.mimeType,
        input.trigger,
      ),
    ),

  reset: sessionOs.handler(({ context }) => {
    context.session.reset();
  }),

  // Current-state snapshot. Idempotent pull used by the client on connect (and
  // on every reconnect) to cover the race where session.init()'s initial
  // publishes land before the events() subscribe has attached. Also useful for
  // post-drift resync later.
  state: sessionOs
    .output(StateOutput)
    .handler(({ context }) => ({
      scene: context.session.getSnapshot(),
    })),
};

export type SessionRouter = typeof sessionRouter;
export type SessionRouterClient = RouterClient<typeof sessionRouter>;
