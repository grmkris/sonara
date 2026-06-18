"use client";

import { BASE, PRESETS } from "@/lib/render/presets";
import { useVisualizerStore } from "@/stores/visualizer";
import type { FeelParam } from "@/stores/visualizer/preset-slice";

import { SliderRow } from "./slider-row";

const secs = (v: number) => `${(v / 1000).toFixed(1)}s`;

// The curated "build your own look" controls — a thin override layer over the
// active preset. Each writes setParamOverride (instant, no crossfade); `+ save`
// in the picker bakes the result into a named profile.
const CONTROLS: {
  field: FeelParam;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}[] = [
  { field: "transitionMs", format: secs, label: "fade", max: 6000, min: 400, step: 50 },
  { field: "rippleAmount", label: "ripple", max: 3, min: 0, step: 0.05 },
  { field: "rippleSpread", label: "spread", max: 1, min: 0, step: 0.01 },
  { field: "bloomMult", label: "bloom", max: 3, min: 0, step: 0.05 },
  { field: "feedbackAmount", label: "trails", max: 0.85, min: 0, step: 0.01 },
  { field: "noiseMult", label: "warp", max: 3, min: 0, step: 0.05 },
  { field: "halation", label: "glow", max: 1, min: 0, step: 0.01 },
  { field: "grain", label: "grain", max: 1, min: 0, step: 0.01 },
];

export const FeelSliders = () => {
  const preset = useVisualizerStore((s) => s.preset);
  const customPreset = useVisualizerStore((s) => s.customPreset);
  const paramOverrides = useVisualizerStore((s) => s.paramOverrides);
  const setParamOverride = useVisualizerStore((s) => s.setParamOverride);

  // The look the sliders read from when not overridden. BASE backfills any
  // field a pre-existing saved profile predates.
  const active = customPreset ?? PRESETS[preset] ?? BASE;

  return (
    <div className="flex flex-col gap-2.5">
      {CONTROLS.map((c) => (
        <SliderRow
          format={c.format}
          key={c.field}
          label={c.label}
          max={c.max}
          min={c.min}
          onChange={(v) => setParamOverride(c.field, v)}
          step={c.step}
          value={paramOverrides[c.field] ?? active[c.field] ?? BASE[c.field]}
        />
      ))}
    </div>
  );
};
