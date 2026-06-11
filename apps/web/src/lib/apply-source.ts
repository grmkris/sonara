import type { SonaraSceneState } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { isKnownPreset } from "@/lib/render/presets";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// The one local "play this set on this canvas" routine — fetch the set, hand
// it to the source slice, let usePlaybackLoop produce. Shared by the
// SourceSwitcher picker, the ?set= consumer path, and the `source.set` server
// event handler, so a set starts playing the exact same way no matter who
// asked.
//
// A set with an authored look applies it as a unit on pick (same contract as
// a deck's DECK_LOOK): render preset locally, reactivity intensity to the
// server when a send is available (viewer pages replay without a session —
// they apply intensity locally instead). Cadence is read live by the loop.
export const startSetReplayById = async (
  setId: string,
  send?: SessionSend
): Promise<boolean> => {
  try {
    const data = await rpcClient.sets.get({ setId: setId as FrameSetId });
    if (data.frames.length === 0 && !data.deckKey) {
      toast("that set is empty");
      return false;
    }
    const store = useVisualizerStore.getState();
    const { look } = data;
    if (look) {
      if (isKnownPreset(look.preset)) {
        store.setPreset(look.preset);
      }
      if (send) {
        send({
          patch: { intensity: look.intensity } as Partial<SonaraSceneState>,
          type: "scene.patch",
        });
      } else {
        useVisualizerStore.setState((s) => ({
          scene: { ...s.scene, intensity: look.intensity },
        }));
      }
    }
    store.setSource(
      {
        deckKey: data.deckKey,
        kind: "set",
        look: data.look,
        name: data.name,
        origin: data.origin,
        setId: data.id,
      },
      data.frames
    );
    return true;
  } catch {
    toast.error("couldn't load that set");
    return false;
  }
};
