"use client";

import { deckLabel } from "@sonara/shared";
import { useEffect } from "react";

import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";
import type { VisualizerState } from "@/stores/visualizer";

// Companion of use-frame-reporter: reports WHAT is showing (live / deck / set
// replay / idle) up to the server (source.report) so /control and any viewer
// can name the source, not just render its frames.
//
// Mount this ONLY on the producer (/play), right next to useFrameReporter.
// The source only changes on transport switches (picking a deck/set, going
// live, stopping), so a plain changed-check is enough — no debounce. Dispatch
// is fire-and-forget; a dropped report self-heals on the next switch.

type ReportedSource = Extract<
  Parameters<SessionSend>[0],
  { type: "source.report" }
>["source"];

// Precedence mirrors the frame producers' mutual exclusion: an active set
// replay wins (it forces demoMode off), then deck playback, then live (a
// generation prompt exists), else idle.
const deriveSource = (s: VisualizerState): ReportedSource => {
  if (s.reelPlaybackActive) {
    return {
      kind: "set",
      label: s.reelPlaybackName,
      ...(s.reelPlaybackId ? { setId: s.reelPlaybackId } : {}),
    };
  }
  if (s.demoMode && s.demoDeck) {
    return { kind: "deck", label: deckLabel(s.demoDeck) };
  }
  if (s.scene.prompt.trim().length > 0) {
    return { kind: "live", label: null };
  }
  return { kind: "idle", label: null };
};

const sameSource = (a: ReportedSource, b: ReportedSource): boolean =>
  a.kind === b.kind && a.label === b.label && a.setId === b.setId;

export const useSourceReporter = (send: SessionSend): void => {
  useEffect(() => {
    let lastReported: ReportedSource | null = null;
    const report = (source: ReportedSource): void => {
      if (lastReported && sameSource(lastReported, source)) {
        return;
      }
      lastReported = source;
      send({ source, type: "source.report" });
    };
    // Catch up on whatever is already showing when the hook mounts.
    report(deriveSource(useVisualizerStore.getState()));
    const unsub = useVisualizerStore.subscribe((s) => {
      report(deriveSource(s));
    });
    return () => {
      unsub();
    };
  }, [send]);
};
