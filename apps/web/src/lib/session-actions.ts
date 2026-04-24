import type {
  AudioFeatures,
  ClientScenePatch,
} from "@music-visualizer/shared";
import type { SessionRouterClient } from "@music-visualizer/api";

// Client-side convenience union for the session surface. Purely local — the
// wire protocol is orpc per-procedure schemas; this is just a thin dispatch
// helper so callers don't have to hold the raw client.
export type SessionAction =
  | { type: "hello"; falKey?: string }
  | { type: "scene.patch"; patch: ClientScenePatch }
  | { type: "audio.features"; features: AudioFeatures }
  | { type: "voice.phrase"; text: string }
  | {
      type: "voice.partial";
      text: string;
      isFinal: boolean;
      confidence?: number;
      provider: "web-speech" | "deepgram";
    }
  | { type: "voice.mode"; mode: "live" | "ptt" }
  | { type: "voice.ptt.start" }
  | { type: "voice.ptt.end" }
  | { type: "audio.start"; sampleRate: number }
  | { type: "audio.stop" }
  | { type: "audio.chunk"; base64: string }
  | { type: "generate.commit" }
  | { type: "session.reset" }
  | {
      type: "audio.recognize";
      clipBase64: string;
      mimeType: string;
      durationMs: number;
      trigger: "auto" | "manual";
    };

export type SessionSend = (action: SessionAction) => void;

export function dispatchSessionAction(
  client: SessionRouterClient,
  action: SessionAction,
): Promise<unknown> {
  switch (action.type) {
    case "hello":
      return client.hello(action.falKey ? { falKey: action.falKey } : {});
    case "scene.patch":
      return client.scenePatch({ patch: action.patch });
    case "audio.features":
      return client.audioFeatures({ features: action.features });
    case "voice.phrase":
      return client.voicePhrase({ text: action.text });
    case "voice.partial":
      return client.voicePartial({
        text: action.text,
        isFinal: action.isFinal,
        provider: action.provider,
        ...(typeof action.confidence === "number"
          ? { confidence: action.confidence }
          : {}),
      });
    case "voice.mode":
      return client.voiceMode({ mode: action.mode });
    case "voice.ptt.start":
      return client.pttStart();
    case "voice.ptt.end":
      return client.pttEnd();
    case "audio.start":
      return client.audioStart({ sampleRate: action.sampleRate });
    case "audio.stop":
      return client.audioStop();
    case "audio.chunk":
      return client.audioChunk({ base64: action.base64 });
    case "generate.commit":
      return client.commit();
    case "session.reset":
      return client.reset();
    case "audio.recognize":
      return client.recognize({
        clipBase64: action.clipBase64,
        mimeType: action.mimeType,
        durationMs: action.durationMs,
        trigger: action.trigger,
      });
  }
}
