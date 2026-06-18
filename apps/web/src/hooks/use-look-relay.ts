"use client";

import type { LookConfig } from "@sonara/shared";
import { useEffect, useRef } from "react";

import { debounce } from "@/lib/debounce";
import { resolveLook } from "@/lib/render/presets";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// Console-only: relay the resolved render look to the screen whenever the
// console's look controls (preset / Feel sliders / applied profile) change.
// The screen applies it via the look.set event → applyLookConfig. The console
// has no canvas of its own, so this is the only path its look edits take effect.
export const useLookRelay = (send: SessionSend): void => {
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    const relay = debounce(() => {
      const s = useVisualizerStore.getState();
      const config = resolveLook(
        s.preset,
        s.customPreset,
        s.paramOverrides
      ) as unknown as LookConfig;
      sendRef.current({ config, type: "look.set" });
    }, 120);

    // Fires only on actual look changes (subscribe doesn't fire on mount), so
    // it relays purely user-driven edits — never clobbers on first load.
    const unsub = useVisualizerStore.subscribe((state, prev) => {
      if (
        state.preset === prev.preset &&
        state.customPreset === prev.customPreset &&
        state.paramOverrides === prev.paramOverrides
      ) {
        return;
      }
      relay();
    });

    return () => {
      unsub();
      relay.cancel();
    };
  }, []);
};
