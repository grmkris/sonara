import type { SessionRouterClient } from "@sonara/api";
import type {
  AudioFeatures,
  ClientScenePatch,
  DeckKey,
  RenderResolution,
  TextModelKey,
} from "@sonara/shared";

// Client-side convenience union for the session surface. Purely local — the
// wire protocol is orpc per-procedure schemas; this is just a thin dispatch
// helper so callers don't have to hold the raw client.
export type SessionAction =
  | { type: "hello" }
  | { type: "scene.patch"; patch: ClientScenePatch }
  | { type: "voice.patch"; patch: ClientScenePatch }
  | { type: "audio.features"; features: AudioFeatures }
  | { type: "session.reset" }
  // "New set": finalize the current recording segment, start the next run in
  // place. The new id arrives via the `run.started` event — no reconnect.
  | { type: "set.new" }
  // Remote source switch (detached console / studio): relayed server-side to
  // the screen as a `source.set` event. Local (attached) picks never dispatch
  // this — they start playback directly (apply-source.ts).
  | {
      type: "source.set";
      source:
        | { kind: "set"; setId: string; label: string | null }
        | { kind: "deck"; deck: DeckKey }
        | { kind: "idle" };
    }
  | { type: "frame.report"; url: string }
  | {
      type: "source.report";
      source: {
        kind: "live" | "deck" | "set" | "idle";
        label: string | null;
        setId?: string;
      };
    }
  | { type: "demo.set"; on: boolean; deck: DeckKey | null }
  | { type: "session.goLive"; prompt: string; seedFrameUrl: string | null }
  | { type: "image.anchor.set"; url: string; strength: number }
  | { type: "image.anchor.clear" }
  | { type: "model.set"; model: TextModelKey }
  | { type: "resolution.set"; resolution: RenderResolution }
  | {
      type: "audio.recognize";
      clipBase64: string;
      mimeType: string;
      durationMs: number;
      trigger: "auto" | "manual";
    };

export type SessionSend = (action: SessionAction) => void;

export const dispatchSessionAction = (
  client: SessionRouterClient,
  action: SessionAction
): Promise<unknown> => {
  // oxlint-disable-next-line default-case -- REVIEW: exhaustive over the SessionAction discriminated union; a default would defeat TS exhaustiveness checks
  switch (action.type) {
    case "hello": {
      return client.hello();
    }
    case "scene.patch": {
      return client.scenePatch({ patch: action.patch });
    }
    case "voice.patch": {
      return client.voicePatch({ patch: action.patch });
    }
    case "audio.features": {
      return client.audioFeatures({ features: action.features });
    }
    case "session.reset": {
      return client.reset();
    }
    case "set.new": {
      return client.newSet();
    }
    case "source.set": {
      // Producer-side: never sent over the WS (the attached console applies
      // sources locally); only the control-router dispatcher maps this.
      return Promise.resolve();
    }
    case "frame.report": {
      return client.reportFrame({ url: action.url });
    }
    case "source.report": {
      return client.reportSource({ source: action.source });
    }
    case "demo.set": {
      return client.setDemoMode({ deck: action.deck, on: action.on });
    }
    case "session.goLive": {
      return client.goLive({
        prompt: action.prompt,
        seedFrameUrl: action.seedFrameUrl,
      });
    }
    case "image.anchor.set": {
      return client.setImageAnchor({
        strength: action.strength,
        url: action.url,
      });
    }
    case "image.anchor.clear": {
      return client.setImageAnchor({ clear: true });
    }
    case "model.set": {
      return client.setModel({ model: action.model });
    }
    case "resolution.set": {
      return client.setResolution({ resolution: action.resolution });
    }
    case "audio.recognize": {
      return client.recognize({
        clipBase64: action.clipBase64,
        durationMs: action.durationMs,
        mimeType: action.mimeType,
        trigger: action.trigger,
      });
    }
  }
};
