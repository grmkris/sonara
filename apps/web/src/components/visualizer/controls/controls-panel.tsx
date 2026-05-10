"use client";

import { useMemo, useState } from "react";
import type { DreamSceneState } from "@music-visualizer/shared";
import type { SessionSend } from "@/lib/session-actions";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PresetPicker } from "@/components/visualizer/controls/preset-picker";
import { SceneTemplatePicker } from "@/components/visualizer/controls/scene-template-picker";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { debounce } from "@/lib/debounce";

interface ControlsPanelProps {
  send: SessionSend;
}

type SliderKey = "softness" | "surrealness" | "abstraction" | "stability";

const SLIDERS: { key: SliderKey; label: string }[] = [
  { key: "softness",    label: "soft"     },
  { key: "surrealness", label: "unreal"   },
  { key: "abstraction", label: "abstract" },
  { key: "stability",   label: "stable"   },
];

export function ControlsPanel({ send }: ControlsPanelProps) {
  const scene = useVisualizerStore((s) => s.scene);

  const patchSlider = (key: SliderKey, value: number) =>
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<DreamSceneState>,
    });

  return (
    <div className="flex flex-col gap-6">
      <SceneTemplatePicker send={send} />

      <Separator className="bg-[color:var(--hairline)]/30" />

      <PresetPicker />

      <Separator className="bg-[color:var(--hairline)]/30" />

      <IntensityDial send={send} />

      <Separator className="bg-[color:var(--hairline)]/30" />

      <div className="flex flex-col gap-4">
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
  );
}

function SliderRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  const [dragging, setDragging] = useState(false);
  // Radix fires per pointer-move. Debounce WS emits to ~16/s; flush on
  // pointer-up / leave / blur so the final value always lands.
  const emit = useMemo(() => debounce(onChange, 60), [onChange]);

  const node = (
    <Slider
      value={[value]}
      min={0}
      max={1}
      step={0.01}
      onValueChange={(v) => {
        const next = v[0];
        if (typeof next === "number") emit(next);
      }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => {
        setDragging(false);
        emit.flush();
      }}
      onPointerLeave={() => {
        setDragging(false);
        emit.flush();
      }}
      onBlur={() => {
        setDragging(false);
        emit.flush();
      }}
    />
  );

  return (
    <div className="flex items-center gap-3">
      <span className="font-serif w-20 shrink-0 text-[13px] text-[color:var(--paper)]/85">
        {label}
      </span>
      <div className="flex-1">
        <Tooltip open={dragging}>
          <TooltipTrigger asChild>
            <div className="flex items-center">{node}</div>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            className="font-mono nums bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 px-2 py-0.5 text-[10px] tracking-[0.14em]"
          >
            {value.toFixed(2)}
          </TooltipContent>
        </Tooltip>
      </div>
      <span className="font-mono nums w-10 text-right text-[10px] text-[color:var(--stone)]">
        {value.toFixed(2)}
      </span>
    </div>
  );
}
