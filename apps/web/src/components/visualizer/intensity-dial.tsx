"use client";

import { useMemo } from "react";
import type { ClientEvent, DreamSceneState } from "@music-visualizer/shared";
import { Slider } from "@/components/ui/slider";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { debounce } from "@/lib/debounce";

interface IntensityDialProps {
  send: (e: ClientEvent) => void;
}

// Master audio→visual coupling dial. Continuous 0..1. Composes VU
// time-constants, onset impulse gain, hue pump range, zoom impulse, AI
// cadence (periodicMs), pause threshold, onset refractory.
export function IntensityDial({ send }: IntensityDialProps) {
  const intensity = useVisualizerStore((s) => s.scene.intensity);

  // Radix Slider fires onValueChange per pointer-move. Debounce WS emits to
  // ~16/s and flush on pointer-up so the final value always lands.
  const emit = useMemo(
    () =>
      debounce((v: number) => {
        send({
          type: "scene.patch",
          patch: { intensity: v } as Partial<DreamSceneState>,
        });
      }, 60),
    [send],
  );

  return (
    <div className="flex min-w-[200px] items-center gap-3">
      <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        intensity
      </span>
      <Slider
        className="flex-1"
        value={[intensity]}
        min={0}
        max={1}
        step={0.01}
        onValueChange={(v) => {
          const next = v[0];
          if (typeof next === "number") emit(next);
        }}
        onPointerUp={() => emit.flush()}
        onPointerLeave={() => emit.flush()}
        onBlur={() => emit.flush()}
      />
      <span className="font-mono nums w-10 text-right text-[10px] text-[color:var(--stone)]">
        {intensity.toFixed(2)}
      </span>
    </div>
  );
}
