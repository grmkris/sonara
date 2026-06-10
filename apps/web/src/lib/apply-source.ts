import type { FrameSetId } from "@sonara/shared/typeid";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { useVisualizerStore } from "@/stores/visualizer";

// The one local "play this set on this canvas" routine — fetch the ordered
// frames, hand them to the set-playback slice, let useSetPlaybackLoop
// produce. Shared by the SourceSwitcher picker, the ?set= consumer path, and
// (W5) the `source.set` server event handler, so a set starts playing the
// exact same way no matter who asked.
export const startSetReplayById = async (setId: string): Promise<boolean> => {
  try {
    const data = await rpcClient.sets.get({ setId: setId as FrameSetId });
    if (data.frames.length === 0) {
      toast("that set is empty");
      return false;
    }
    useVisualizerStore.getState().startSetPlayback({
      cadence: data.origin === "recording" ? "original" : "fixed",
      frames: data.frames,
      id: data.id,
      name: data.name,
    });
    return true;
  } catch {
    toast.error("couldn't load that set");
    return false;
  }
};
