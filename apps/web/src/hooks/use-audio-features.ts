"use client";

import { useEffect, useRef } from "react";
import type { AudioFeatures, ClientEvent } from "@music-visualizer/shared";
import { AudioEngine } from "@/lib/audio/analyzer";
import { useVisualizerStore } from "@/stores/visualizer-store";

const UPSTREAM_HZ = 5;
const UPSTREAM_INTERVAL_MS = 1000 / UPSTREAM_HZ;

export type AudioSource =
  | { type: "none" }
  | { type: "element"; element: HTMLAudioElement }
  | { type: "mic" };

export function useAudioFeatures(
  source: AudioSource,
  send: (event: ClientEvent) => void,
  onError?: (err: unknown) => void,
): void {
  const engineRef = useRef<AudioEngine | null>(null);
  const lastSentAtRef = useRef(0);

  // Engine lifetime is tied to the component, NOT the source. Source changes
  // call detachSource()+re-attach so we don't thrash the AudioContext.
  useEffect(() => {
    const engine = new AudioEngine();
    engineRef.current = engine;

    const tick = (features: AudioFeatures) => {
      useVisualizerStore.getState().setAudio(features);
      const now = performance.now();
      if (now - lastSentAtRef.current >= UPSTREAM_INTERVAL_MS) {
        lastSentAtRef.current = now;
        send({ type: "audio.features", features });
      }
    };
    engine.onTick(tick);

    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [send]);

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
