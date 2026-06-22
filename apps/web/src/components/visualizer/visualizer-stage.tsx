"use client";

import type { LibraryFrame, SetLook } from "@sonara/shared";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { useAudioFeatures } from "@/hooks/use-audio-features";
import type { AudioSource } from "@/hooks/use-audio-features";
import { usePlaybackLoop } from "@/hooks/use-playback-loop";
import { isKnownPreset } from "@/lib/render/presets";
import { useVisualizerStore } from "@/stores/visualizer";

// The real WebGL visualizer, embeddable in a sized container (the canvas is
// already parent-sized — only each page's <main> pins it fullscreen). Drives
// the global visualizer store from a set's frames exactly like the /s/[id]
// replay path, plus viewer-local audio (same engine as /play, features never
// go upstream). Mount it ONLY while visible — collapsing the host unmounts it,
// which tears the WebGL context down and idles the GPU.
//
// Always plays the frames ORDERED with their durations (deckKey null, origin
// "curated"): the preview reflects the edited arrangement — i.e. exactly what
// "save as set" will produce — never a built-in's shuffle or a recording's
// original scatter.

interface VisualizerStageProps {
  frames: LibraryFrame[];
  look: SetLook | null;
  name: string;
  setId: string;
  audioSource: AudioSource;
  setAudioSource: (s: AudioSource) => void;
  // Play vs. paused. While false the store idles (the canvas holds its last
  // frame); while true the playback loop drives frames.
  active: boolean;
}

const noopSend = (): void => {
  // Studio preview audio is viewer-local — features never go upstream.
};

export const VisualizerStage = ({
  frames,
  look,
  name,
  setId,
  audioSource,
  setAudioSource,
  active,
}: VisualizerStageProps) => {
  // Drive the global store from the set while active; idle (freeze) when paused
  // or unmounted, so a leftover source never bleeds into /play.
  useEffect(() => {
    const s = useVisualizerStore.getState();
    if (!active) {
      s.stopToIdle();
      return;
    }
    if (look) {
      if (isKnownPreset(look.preset)) {
        s.setPreset(look.preset);
      }
      useVisualizerStore.setState((st) => ({
        scene: { ...st.scene, intensity: look.intensity },
      }));
    }
    s.setSource(
      { deckKey: null, kind: "set", look, name, origin: "curated", setId },
      frames
    );
    return () => {
      useVisualizerStore.getState().stopToIdle();
    };
  }, [active, frames, look, name, setId]);

  usePlaybackLoop();

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
