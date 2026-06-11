import type { LiveSessionId } from "@sonara/shared/typeid";
import type { AppRouterClient } from "server/rpc";

import type { SessionAction } from "./session-actions";

// What the control router addresses: the durable stage (new clients) or a
// raw run id (legacy fallback — /s/[id]/control before its redirect kicks
// in). The server's ByTarget union accepts either; the legacy arm dies in
// the post-W2 cleanup.
export type ControlTarget =
  | { stageId: string }
  | { liveSessionId: LiveSessionId };

// Remote (operator) counterpart to dispatchSessionAction. Maps the same
// client-side SessionAction union onto the authed HTTP `control` router, with
// the target baked in, so the existing controls drive a remote session
// unchanged. The Display still owns the WebSocket — these are writes into its
// live Session; the Display's canvas updates over its own socket.
//
// Audio (features + recognize) never leaves the projector, and `hello` is a
// WS-init handshake, so those are no-ops here.
export const dispatchControlAction = (
  client: AppRouterClient,
  target: ControlTarget,
  action: SessionAction
): Promise<unknown> => {
  const c = client.control;
  switch (action.type) {
    case "scene.patch":
    case "voice.patch": {
      // No remote voice path — both fold onto scenePatch (the operator types).
      return c.scenePatch({ ...target, patch: action.patch });
    }
    case "session.reset": {
      return c.reset(target);
    }
    case "set.new": {
      // Stage-addressed only — a legacy run target has no stable identity to
      // re-key under, and the old client never sends this action anyway.
      return "stageId" in target
        ? c.newSet({ stageId: target.stageId })
        : Promise.resolve();
    }
    case "source.set": {
      // Stage-addressed only, same rationale as set.new.
      return "stageId" in target
        ? c.setSource({ source: action.source, stageId: target.stageId })
        : Promise.resolve();
    }
    case "demo.set": {
      return c.setDemoMode({ ...target, deck: action.deck, on: action.on });
    }
    case "session.goLive": {
      // The operator has no canvas, so there's no on-screen frame to seed
      // from — control.goLive seeds from the server's last frame instead.
      return c.goLive({ ...target, prompt: action.prompt });
    }
    case "image.anchor.set": {
      return c.setImageAnchor({ ...target, url: action.url });
    }
    case "image.anchor.clear": {
      return c.setImageAnchor({ ...target, clear: true });
    }
    case "hello":
    case "audio.features":
    case "audio.recognize": {
      return Promise.resolve();
    }
    default: {
      return Promise.resolve();
    }
  }
};
