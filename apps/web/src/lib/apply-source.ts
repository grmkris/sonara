import { DECK_LOOK, deckLabel } from "@sonara/shared";
import type { DeckKey, SetLook, SonaraSceneState } from "@sonara/shared";
import type { FrameSetId } from "@sonara/shared/typeid";
import { toast } from "sonner";

import { rpcClient } from "@/lib/orpc";
import { isKnownPreset } from "@/lib/render/presets";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// Apply a look profile as a unit on pick: render preset locally, reactivity
// intensity to the server when a send is available (no-session surfaces — the
// marketing backplate, viewer replays — apply intensity locally instead).
// Cadence is read live by the playback loop.
const applyLook = (look: SetLook | null, send?: SessionSend): void => {
  if (!look) {
    return;
  }
  const store = useVisualizerStore.getState();
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
};

// Play a BUILTIN set with no fetch: deckKey is the self-sufficient manifest
// capability, so this works offline, for anon (sets.list is protected — no
// DB id known, setId stays null), and for the backplate (no WS at all). The
// id-ful caller (switcher rows from sets.list) passes setId/name/look from
// the summary; fallers-back pass just the deckKey.
export const applyBuiltinSetLocally = (
  input: {
    deckKey: DeckKey;
    setId?: string | null;
    name?: string | null;
    look?: SetLook | null;
  },
  send?: SessionSend
): void => {
  const store = useVisualizerStore.getState();
  const look = input.look ?? DECK_LOOK[input.deckKey] ?? null;
  applyLook(look, send);
  if (store.source.kind === "live" && send) {
    // Leaving live for playback: clear any anchor + prompt so the server
    // stops generating (ported from the old deck-pick path).
    store.clearAnchor();
    send({ type: "image.anchor.clear" });
    send({ patch: { prompt: "" }, type: "scene.patch" });
  }
  store.setSource(
    {
      deckKey: input.deckKey,
      kind: "set",
      look,
      name: input.name ?? deckLabel(input.deckKey),
      origin: "builtin",
      setId: input.setId ?? null,
    },
    []
  );
};

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
    applyLook(data.look, send);
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
