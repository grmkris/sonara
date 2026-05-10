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
  applyVoice(text: string): void;
  applyVoicePartial(opts: {
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "web-speech";
  }): void;
  recognize(
    clipBase64: string,
    mimeType: string,
    trigger: "auto" | "manual",
  ): Promise<NowPlaying | null>;
  commit(): void;
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

const VoicePhraseInput = z.object({
  text: z.string().min(1).max(200),
});

const VoicePartialInput = z.object({
  text: z.string().min(1).max(400),
  isFinal: z.boolean(),
  confidence: z.number().min(0).max(1).optional(),
  provider: z.enum(["web-speech"]).default("web-speech"),
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
  // receives every server-initiated event (frame previews/finals, scene
  // patches, now.playing, job.status, confirm.reset, preset.suggest).
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

  voicePhrase: sessionOs
    .input(VoicePhraseInput)
    .handler(({ context, input }) => {
      context.session.applyVoice(input.text);
    }),

  voicePartial: sessionOs
    .input(VoicePartialInput)
    .handler(({ context, input }) => {
      context.session.applyVoicePartial({
        text: input.text,
        isFinal: input.isFinal,
        provider: input.provider,
        ...(typeof input.confidence === "number"
          ? { confidence: input.confidence }
          : {}),
      });
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

  commit: sessionOs.handler(({ context }) => {
    context.session.commit();
  }),

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
