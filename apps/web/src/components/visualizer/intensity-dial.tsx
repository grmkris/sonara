"use client";

import type { ClientEvent, DreamSceneState } from "@music-visualizer/shared";
import { Slider } from "@/components/ui/slider";
import { useVisualizerStore } from "@/stores/visualizer-store";

interface IntensityDialProps {
  send: (e: ClientEvent) => void;
}

// Master audio→visual coupling dial. Continuous 0..1. Composes VU
// time-constants, onset impulse gain, hue pump range, zoom impulse, AI
// cadence (periodicMs), pause threshold, onset refractory — see plan D1.
//
// Label is a single kanji 激 (intensity/vigor) matching the single-kanji
// pattern used by the other sliders in the controls panel. English gloss in
// small-caps matches the rest of the UI.
export function IntensityDial({ send }: IntensityDialProps) {
  const intensity = useVisualizerStore((s) => s.scene.intensity);

  const onChange = (v: number) => {
    send({
      type: "scene.patch",
      patch: { intensity: v } as Partial<DreamSceneState>,
    });
  };

  return (
    <div className="flex min-w-[200px] items-center gap-3">
      <div className="flex flex-col leading-none">
        <span className="font-mincho text-[15px] text-[color:var(--paper)]">
          激
        </span>
        <span className="font-kaku mt-1 text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          intensity
        </span>
      </div>
      <Slider
        className="w-[140px]"
        value={[intensity]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={(v) => {
          const next = v[0];
          if (typeof next === "number") onChange(next);
        }}
      />
      <span className="font-plex nums w-10 text-right text-[10px] text-[color:var(--stone)]">
        {intensity.toFixed(2)}
      </span>
    </div>
  );
}
