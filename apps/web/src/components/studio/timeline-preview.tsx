"use client";

import type { SetLook } from "@sonara/shared";
import { ChevronUp, Pause, Play } from "lucide-react";
import { useState } from "react";

import { MusicSource } from "@/components/visualizer/controls/music-source";
import { VisualizerStage } from "@/components/visualizer/visualizer-stage";
import type { AudioSource } from "@/hooks/use-audio-features";

interface TimelinePreviewProps {
  look: SetLook | null;
  // Controlled by the editor so the preview and the timeline playhead share one
  // playback state (see use-timeline-playback).
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
}

// The studio preview window: the REAL audio-reactive visualizer, embedded above
// the timeline, playing the set you're editing (ordered, with your trims) — so
// you can see and hear it before "save as set". Collapsed by default; the WebGL
// canvas only mounts while expanded (GPU cost is opt-in). The MusicSource
// control feeds it room audio so the look reacts. Play/pause + scrubbing are
// connected to the timeline playhead by the editor.
export const TimelinePreview = ({
  look,
  expanded,
  setExpanded,
  playing,
  setPlaying,
}: TimelinePreviewProps) => {
  const [audioSource, setAudioSource] = useState<AudioSource>({ type: "none" });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="focus-ring inline-flex shrink-0 items-center gap-1.5 self-start border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
      >
        <Play className="size-3" strokeWidth={1.5} />
        preview
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "pause" : "play"}
          className="focus-ring inline-flex items-center justify-center border border-[color:var(--hairline)]/40 p-1.5 text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
        >
          {playing ? (
            <Pause className="size-3.5" strokeWidth={1.5} />
          ) : (
            <Play className="size-3.5" strokeWidth={1.5} />
          )}
        </button>
        <MusicSource source={audioSource} setSource={setAudioSource} />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
          {audioSource.type === "none" ? "asleep · add sound" : "live"}
        </span>
        <button
          type="button"
          onClick={() => setExpanded(false)}
          aria-label="hide preview"
          className="focus-ring ml-auto inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
        >
          <ChevronUp className="size-3" strokeWidth={1.5} />
          hide
        </button>
      </div>
      <div className="relative h-[clamp(180px,32vh,440px)] w-full overflow-hidden rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]">
        <VisualizerStage
          look={look}
          audioSource={audioSource}
          setAudioSource={setAudioSource}
        />
      </div>
    </div>
  );
};
