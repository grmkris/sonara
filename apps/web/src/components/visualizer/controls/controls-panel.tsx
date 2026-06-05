"use client";

import type { SonaraSceneState } from "@sonara/shared";

import { DeckPicker } from "@/components/visualizer/controls/deck-picker";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PresetPicker } from "@/components/visualizer/controls/preset-picker";
import { SliderRow } from "@/components/visualizer/controls/slider-row";
import type { SessionSend } from "@/lib/session-actions";
import { useVisualizerStore } from "@/stores/visualizer";

interface ControlsPanelProps {
  send: SessionSend;
}

type SliderKey = "softness" | "surrealness" | "abstraction" | "stability";

const SLIDERS: { key: SliderKey; label: string }[] = [
  { key: "softness", label: "soft" },
  { key: "surrealness", label: "unreal" },
  { key: "abstraction", label: "abstract" },
  { key: "stability", label: "stable" },
];

// One flat mixer — no tabs. The console used to split into scene / style /
// inspector tabs, but two of those didn't earn the split:
//   • "scene" (prompt-starter chips) duplicated "start from a look" and only
//     worked for signed-in users, so it moved next to the prompt input.
//   • "inspector" was a read-only debug readout — now /studio territory.
// What remains is a single top-to-bottom signal chain: pick a look → set how
// reactive it is (INTENSITY, the master dial) → refine the visual treatment
// (preset + feel). Hairline rules segment the three movements.

const Divider = () => (
  <div aria-hidden className="h-px w-full bg-[color:var(--hairline)]/20" />
);

export const ControlsPanel = ({ send }: ControlsPanelProps) => {
  const scene = useVisualizerStore((s) => s.scene);

  const patchSlider = (key: SliderKey, value: number) =>
    send({
      patch: { [key]: value } as Partial<SonaraSceneState>,
      type: "scene.patch",
    });

  return (
    <div className="relative flex flex-col gap-5 rounded-sm border border-[color:var(--hairline)]/25 p-4">
      {/* Source — the look you start from. */}
      <DeckPicker send={send} />

      <Divider />

      {/* Energy — the master audio→visual coupling, given room to read as the
          primary live dial rather than one slider among many. */}
      <IntensityDial send={send} />

      <Divider />

      {/* Treatment — the render preset (shader filter on top of the source)
          plus the four image-feel sliders. */}
      <div className="panel-reveal flex flex-col gap-5">
        <PresetPicker />
        <div className="flex flex-col gap-3">
          {SLIDERS.map((s) => (
            <SliderRow
              key={s.key}
              label={s.label}
              value={scene[s.key]}
              onChange={(v) => patchSlider(s.key, v)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
