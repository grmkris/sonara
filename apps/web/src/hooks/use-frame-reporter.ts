"use client";

import { useEffect } from "react";

import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

// Reports the frame actually on screen up to the server (frame.report) so the
// /control preview — and any future viewer — can render it in EVERY mode,
// including the ones the server never generates in (decks, reel replay).
//
// Mount this ONLY on the producer (/play). Viewer surfaces must never report —
// they'd overwrite the producer's truth with their own polled copy.
//
// currentFrame only changes on keyframe boundaries (every 2–6s; the 60fps
// shader motion never touches it), so a plain changed-check is enough — no
// debounce. Dispatch is fire-and-forget; a dropped report self-heals on the
// next keyframe.
export const useFrameReporter = (send: SessionSend): void => {
  useEffect(() => {
    let lastReported: string | null = null;
    const report = (url: string | null): void => {
      if (!url || url === lastReported) {
        return;
      }
      lastReported = url;
      send({ type: "frame.report", url });
    };
    // Catch up on whatever is already showing when the hook mounts (e.g. the
    // demo loop pushed a frame before the WS connected).
    report(useVisualizerStore.getState().currentFrame);
    const unsub = useVisualizerStore.subscribe((s, prev) => {
      if (s.currentFrame === prev.currentFrame) {
        return;
      }
      report(s.currentFrame);
    });
    return () => {
      unsub();
    };
  }, [send]);
};
