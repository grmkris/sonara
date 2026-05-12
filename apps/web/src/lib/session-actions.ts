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
  | { type: "voice.patch"; patch: ClientScenePatch }
  | { type: "audio.features"; features: AudioFeatures }
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
    case "voice.patch":
      return client.voicePatch({ patch: action.patch });
    case "audio.features":
      return client.audioFeatures({ features: action.features });
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
