"use client";

import type { SetLook } from "@sonara/shared";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { useAudioFeatures } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { isKnownPreset } from "@/lib/render/presets";
import { useVisualizerStore } from "@/stores/visualizer";

// The real WebGL visualizer, embeddable in a sized container (the canvas is
// already parent-sized — only each page's <main> pins it fullscreen). Mount it
// ONLY while visible; unmounting tears the WebGL context down and idles the
// GPU.
//
// It only RENDERS: it applies the set's look (preset + intensity) and runs
// viewer-local audio (same engine as /play; features never go upstream). The
// FRAMES are pushed straight into the store by the timeline clock
// (use-timeline-playback), so the timeline IS the playback source of truth and
// nothing here issues setSource — no source can bleed into /play.

interface VisualizerStageProps {
  look: SetLook | null;
  audioSource: AudioSource;
  setAudioSource: (s: AudioSource) => void;
}

const noopSend = (): void => {
  // Studio preview audio is viewer-local — features never go upstream.
};

export const VisualizerStage = ({
  look,
  audioSource,
  setAudioSource,
}: VisualizerStageProps) => {
  useEffect(() => {
    if (!look) {
      return;
    }
    const s = useVisualizerStore.getState();
    if (isKnownPreset(look.preset)) {
      s.setPreset(look.preset);
    }
    useVisualizerStore.setState((st) => ({
      scene: { ...st.scene, intensity: look.intensity },
    }));
  }, [look]);

  const onAudioError = useCallback(
    (err: unknown) => {
      const reason =
        err instanceof Error ? err.name || err.message : "unavailable";
      // NotAllowedError = the user cancelled the picker / denied mic — a silent
      // reset is friendlier than a toast (same as the /s viewer).
      if (reason !== "NotAllowedError") {
        toast.error("audio unavailable", { description: reason, duration: 3200 });
      }
      setAudioSource({ type: "none" });
    },
    [setAudioSource]
  );
  const onAudioLost = useCallback(() => {
    toast("audio stopped", { duration: 2200 });
    setAudioSource({ type: "none" });
  }, [setAudioSource]);

  useAudioFeatures(audioSource, noopSend, onAudioError, onAudioLost);

  return <SonaraCanvas dimmed={audioSource.type === "none"} />;
};
