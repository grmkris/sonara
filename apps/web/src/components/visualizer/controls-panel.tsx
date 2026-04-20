"use client";

import { useState } from "react";
import type { ClientEvent, DreamSceneState } from "@music-visualizer/shared";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IntensityDial } from "@/components/visualizer/intensity-dial";
import { PresetPicker } from "@/components/visualizer/preset-picker";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

interface ControlsPanelProps {
  send: (e: ClientEvent) => void;
}

type SliderKey = "softness" | "surrealness" | "abstraction" | "stability";
type ToggleKey =
  | "preserveIdentity"
  | "preserveComposition"
  | "preservePalette";

const SLIDERS: { key: SliderKey; label: string }[] = [
  { key: "softness",    label: "soft"     },
  { key: "surrealness", label: "unreal"   },
  { key: "abstraction", label: "abstract" },
  { key: "stability",   label: "stable"   },
];

const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: "preserveIdentity",    label: "identity"    },
  { key: "preserveComposition", label: "composition" },
  { key: "preservePalette",     label: "palette"     },
];

export function ControlsPanel({ send }: ControlsPanelProps) {
  const scene = useVisualizerStore((s) => s.scene);

  const patchSlider = (key: SliderKey, value: number) =>
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<DreamSceneState>,
    });
  const patchToggle = (key: ToggleKey, value: boolean) =>
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<DreamSceneState>,
    });

  return (
    <div className="flex flex-col gap-6">
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

      <Separator className="bg-[color:var(--hairline)]/30" />

      <div className="flex flex-col gap-1.5">
        {TOGGLES.map((t) => {
          const on = scene[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => patchToggle(t.key, !on)}
              className={cn(
                "group flex items-baseline gap-3 self-start transition-colors",
                on
                  ? "text-[color:var(--paper)]"
                  : "text-[color:var(--stone)] hover:text-[color:var(--paper)]/80",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "w-3 text-center text-[12px] leading-none transition-opacity",
                  on ? "opacity-100" : "opacity-0",
                )}
              >
                •
              </span>
              <span className="font-serif text-[13px]">{t.label}</span>
            </button>
          );
        })}
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

  const node = (
    <Slider
      value={[value]}
      min={0}
      max={1}
      step={0.01}
      onValueChange={(v) => {
        const next = v[0];
        if (typeof next === "number") onChange(next);
      }}
      onPointerDown={() => setDragging(true)}
      onPointerUp={() => setDragging(false)}
      onPointerLeave={() => setDragging(false)}
      onBlur={() => setDragging(false)}
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
