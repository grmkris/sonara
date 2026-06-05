import type { LiveSessionId } from "@sonara/shared/typeid";
import type { AppRouterClient } from "server/rpc";

import type { SessionAction } from "./session-actions";

// Remote (operator) counterpart to dispatchSessionAction. Maps the same
// client-side SessionAction union onto the authed HTTP `control` router, with
// the target liveSessionId baked in, so the existing controls drive a remote
// session unchanged. The Display still owns the WebSocket — these are writes
// into its live Session; the Display's canvas updates over its own socket.
//
// Audio (features + recognize) never leaves the projector, and `hello` is a
// WS-init handshake, so those are no-ops here.
export function dispatchControlAction(
  client: AppRouterClient,
  liveSessionId: LiveSessionId,
  action: SessionAction
): Promise<unknown> {
  const c = client.control;
  switch (action.type) {
    case "scene.patch":
    case "voice.patch": {
      // No remote voice path — both fold onto scenePatch (the operator types).
      return c.scenePatch({ liveSessionId, patch: action.patch });
    }
    case "session.reset": {
      return c.reset({ liveSessionId });
    }
    case "demo.set": {
      return c.setDemoMode({ liveSessionId, on: action.on, deck: action.deck });
    }
    case "session.goLive": {
      // The operator has no canvas, so there's no on-screen frame to seed
      // from — control.goLive seeds from the server's last frame instead.
      return c.goLive({ liveSessionId, prompt: action.prompt });
    }
    case "image.anchor.set": {
      return c.setImageAnchor({
        liveSessionId,
        url: action.url,
        strength: action.strength,
      });
    }
    case "image.anchor.clear": {
      return c.setImageAnchor({ liveSessionId, clear: true });
    }
    case "hello":
    case "audio.features":
    case "audio.recognize": {
      return Promise.resolve();
    }
  }
}
