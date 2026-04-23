"use client";

import { useEffect } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";

// Drain rule: if bpm is known, release one chain frame per beat-phase wrap
// (downbeat). If bpm is 0 (no music detected), release every FALLBACK_MS so
// the chain doesn't stall. Called once at the app root.
const FALLBACK_MS = 600;
// Guard against double-release inside the same bpmPhase wrap — multiple
// audio pushes can land in the same UI frame.
const MIN_BEAT_GAP_MS = 220;

export function useChainDrain(): void {
  useEffect(() => {
    const store = useVisualizerStore;
    let lastDrainAt = 0;
    let lastPhase = store.getState().audio.bpmPhase;
    let rafId = 0;

    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const s = store.getState();
      if (s.pendingChain.length === 0) {
        lastPhase = s.audio.bpmPhase;
        return;
      }
      const now = performance.now();
      const phase = s.audio.bpmPhase;
      const bpm = s.audio.bpm;

      let shouldDrain = false;
      if (bpm > 0) {
        // Wrap: phase decreased sharply (crossed 1 → 0).
        if (phase + 0.5 < lastPhase && now - lastDrainAt > MIN_BEAT_GAP_MS) {
          shouldDrain = true;
        }
      } else if (now - lastDrainAt > FALLBACK_MS) {
        shouldDrain = true;
      }

      if (shouldDrain) {
        s.dequeueChainFrame();
        lastDrainAt = now;
      }
      lastPhase = phase;
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);
}
