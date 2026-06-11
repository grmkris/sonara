"use client";

import { DECK_LOOK } from "@sonara/shared";
import type { DeckKey, SonaraSceneState } from "@sonara/shared";
import { useCallback } from "react";

import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// The deck-pick behaviour, shared by the Now-Showing SourceSwitcher (and any
// future deck surface): apply the deck's look profile, clean up a live
// session if leaving one, and switch the unified source. The playback loop
// (usePlaybackLoop) starts producing from the deck's static manifest on the
// source change; the source reporter tells the server — no dedicated WS
// mutation anymore. (The old standalone DeckPicker component is gone — the
// SourceSwitcher's decks group is the only deck surface.)
export const usePickDeck = (send: SessionSend): ((deck: string) => void) => {
  const source = useVisualizerStore((s) => s.source);
  const setSource = useVisualizerStore((s) => s.setSource);
  const setPreset = useVisualizerStore((s) => s.setPreset);
  const clearAnchor = useVisualizerStore((s) => s.clearAnchor);

  const isLive = source.kind === "live";

  return useCallback(
    (deck: string) => {
      if (!deck) {
        return;
      }
      const next = deck as DeckKey;

      // Apply the deck's look profile as a unit: render preset + default
      // reactivity intensity (cadence is read live from DECK_LOOK by the
      // playback loop). This is what makes Noir actually chill — it swaps the
      // global `rave` strobe for the no-invert `noir` preset and drops
      // intensity, so the whole vibe travels with the deck. Decks without a
      // profile are left as-is.
      const look = DECK_LOOK[next];
      if (look) {
        setPreset(look.preset);
        send({
          patch: { intensity: look.intensity } as Partial<SonaraSceneState>,
          type: "scene.patch",
        });
      }

      if (isLive) {
        // Click-while-live: switch BACK to deck playback. Clear any live
        // anchor + prompt so the server stops generating.
        clearAnchor();
        send({ type: "image.anchor.clear" });
        send({ patch: { prompt: "" }, type: "scene.patch" });
      }
      setSource({ deck: next, kind: "deck" });
    },
    [isLive, send, setSource, setPreset, clearAnchor]
  );
};
