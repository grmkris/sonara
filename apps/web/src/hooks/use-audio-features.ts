"use client";

import { useEffect, useRef } from "react";
import type { AudioFeatures } from "@music-visualizer/shared";
import type { SessionSend } from "@/lib/session-actions";
import { AudioEngine } from "@/lib/audio/analyzer";
import { createMusicalityGate } from "@/lib/audio/musicality-gate";
import { useVisualizerStore } from "@/stores/visualizer";

const UPSTREAM_HZ = 5;
const UPSTREAM_INTERVAL_MS = 1000 / UPSTREAM_HZ;

export type AudioSource =
  | { type: "none" }
  | { type: "element"; element: HTMLAudioElement }
  | { type: "mic" }
  | { type: "display" };

// Module-level handle to the current AudioEngine so sibling components
// (WaveformRibbon, SpectrumCurve, etc.) can read the AnalyserNode directly
// without prop-drilling. Only ever one engine per app lifetime.
let currentEngine: AudioEngine | null = null;
export function getCurrentAudioEngine(): AudioEngine | null {
  return currentEngine;
}

export function useAudioFeatures(
  source: AudioSource,
  send: SessionSend,
  onError?: (err: unknown) => void,
  onSourceLost?: () => void,
): void {
  const engineRef = useRef<AudioEngine | null>(null);
  const lastSentAtRef = useRef(0);

  // Engine lifetime is tied to the component, NOT the source. Source changes
  // call detachSource()+re-attach so we don't thrash the AudioContext.
  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;
    currentEngine = engine;

    // Musicality gate: suppress the 5 Hz upstream send on silence / chatter /
    // ambient noise so the server doesn't fire periodic fal keyframes when the
    // room is quiet or only speech/applause is detected. Local visuals remain
    // unconditional so the UI keeps breathing even when we aren't committing
    // server cost.
    const gate = createMusicalityGate();

    const tick = (features: AudioFeatures) => {
      useVisualizerStore.getState().setAudio(features);
      const now = performance.now();
      gate.update(now, features.flatness, features.onset);
      if (
        gate.isMusic() &&
        now - lastSentAtRef.current >= UPSTREAM_INTERVAL_MS
      ) {
        lastSentAtRef.current = now;
        send({ type: "audio.features", features });
      }
    };
    engine.onTick(tick);
    // Relay "source lost" (user hit Stop sharing in the browser) so the UI
    // can reset the source picker to "none".
    engine.onSourceLost(() => onSourceLost?.());

    return () => {
      engine.stop();
      engineRef.current = null;
      if (currentEngine === engine) currentEngine = null;
    };
  }, [send, onSourceLost]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    let cancelled = false;

    const attach = async () => {
      try {
        if (source.type === "element") {
          await engine.attachElement(source.element);
        } else if (source.type === "mic") {
          await engine.attachMic();
        } else if (source.type === "display") {
          await engine.attachDisplay();
        } else {
          engine.detachSource();
        }
        if (cancelled) engine.detachSource();
      } catch (err) {
        if (!cancelled) onError?.(err);
      }
    };

    attach();

    return () => {
      cancelled = true;
      engine.detachSource();
    };
  }, [source, onError]);
}
