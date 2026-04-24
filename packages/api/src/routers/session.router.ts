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
    provider: "web-speech" | "deepgram";
  }): void;
  // Server-side STT relay (Deepgram Flux path). Browser captures PCM16/16k
  // mono, base64-encodes ~100ms chunks, and pumps them through audioChunk
  // while audioStart/audioStop bracket the lifecycle.
  audioStart(opts: { sampleRate: number }): void;
  audioStop(): void;
  audioChunk(base64: string): void;
  // Voice mode + push-to-talk. Client drives setVoiceMode on toggle, and
  // pttStart/pttEnd on SPACE keydown/keyup when in "ptt" mode. In "live"
  // mode Flux's own EndOfTurn signal drives commits; in "ptt" the key
  // release flushes the voice debounce immediately.
  setVoiceMode(mode: "live" | "ptt"): void;
  pttStart(): void;
  pttEnd(): void;
  // Surface server config the client needs at boot time. Currently just
  // whether the server has a Deepgram key wired up — the client picks
  // its STT path based on this.
  sttProvider(): "deepgram" | "web-speech";
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
  provider: z.enum(["web-speech", "deepgram"]).default("web-speech"),
});

const AudioStartInput = z.object({
  sampleRate: z.number().int().positive(),
});

// Base64-encoded PCM16 audio chunk. ~100ms at 16kHz mono = 3200 bytes raw,
// ~4267 bytes base64. Cap is generous to allow occasional larger frames.
const AudioChunkInput = z.object({
  base64: z.string().min(1).max(40_000),
});

const VoiceModeInput = z.object({
  mode: z.enum(["live", "ptt"]),
});

const RecognizeInput = z.object({
  clipBase64: z.string().min(1).max(400_000),
  mimeType: z.string().min(1).max(120),
  durationMs: z.number().int().positive(),
  trigger: z.enum(["auto", "manual"]),
});

const StateOutput = z.object({
  scene: DreamSceneState,
  sttProvider: z.enum(["deepgram", "web-speech"]),
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

  audioStart: sessionOs
    .input(AudioStartInput)
    .handler(({ context, input }) => {
      context.session.audioStart({ sampleRate: input.sampleRate });
    }),

  audioStop: sessionOs.handler(({ context }) => {
    context.session.audioStop();
  }),

  audioChunk: sessionOs
    .input(AudioChunkInput)
    .handler(({ context, input }) => {
      context.session.audioChunk(input.base64);
    }),

  voiceMode: sessionOs
    .input(VoiceModeInput)
    .handler(({ context, input }) => {
      context.session.setVoiceMode(input.mode);
    }),

  pttStart: sessionOs.handler(({ context }) => {
    context.session.pttStart();
  }),

  pttEnd: sessionOs.handler(({ context }) => {
    context.session.pttEnd();
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
      sttProvider: context.session.sttProvider(),
    })),
};

export type SessionRouter = typeof sessionRouter;
export type SessionRouterClient = RouterClient<typeof sessionRouter>;
