import type { AppRouterClient } from "server/rpc";

import type { SessionAction } from "./session-actions";

// What the control router addresses: the durable stage. Runs come and go
// ("new set" swaps the run under the same stage); the stage id is stable.
export interface ControlTarget {
  stageId: string;
}

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
      return c.newSet({ stageId: target.stageId });
    }
    case "source.set": {
      return c.setSource({ source: action.source, stageId: target.stageId });
    }
    case "look.set": {
      return c.setLook({ config: action.config, stageId: target.stageId });
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
