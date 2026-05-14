"use client";

import { useMemo, useState } from "react";
import type { SonaraSceneState } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { DemoModeToggle } from "@/components/visualizer/controls/demo-mode-toggle";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PresetPicker } from "@/components/visualizer/controls/preset-picker";
import { SceneTemplatePicker } from "@/components/visualizer/controls/scene-template-picker";
import { GenerationInspector } from "@/components/visualizer/controls/generation-inspector";
import { useVisualizerStore, type ConsoleTab } from "@/stores/visualizer";
import { debounce } from "@/lib/debounce";
import { cn } from "@/lib/utils";

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

const TABS: { id: ConsoleTab; label: string }[] = [
  { id: "scene",     label: "scene"     },
  { id: "style",     label: "style"     },
  { id: "inspector", label: "inspector" },
];

export function ControlsPanel({ send }: ControlsPanelProps) {
  const scene = useVisualizerStore((s) => s.scene);
  const tab = useVisualizerStore((s) => s.consoleTab);
  const pickTab = useVisualizerStore((s) => s.setConsoleTab);

  const patchSlider = (key: SliderKey, value: number) =>
    send({
      type: "scene.patch",
      patch: { [key]: value } as Partial<SonaraSceneState>,
    });

  return (
    <div className="flex flex-col gap-5">
      <DemoModeToggle send={send} />

      {/* Tab strip — serif italics, underline on active. */}
      <nav
        role="tablist"
        aria-label="console"
        className="flex items-baseline gap-5"
      >
        {TABS.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => pickTab(t.id)}
              className={cn(
                "font-serif text-[13px] italic tracking-normal transition-colors",
                "border-b pb-1",
                active
                  ? "border-[color:var(--paper)] text-[color:var(--paper)]"
                  : "border-transparent text-[color:var(--stone)] hover:text-[color:var(--paper)]/85 hover:border-[color:var(--hairline)]/30",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </nav>

      {/* Active tab panel. */}
      <div key={tab} role="tabpanel" className="panel-reveal flex flex-col gap-5">
        {tab === "scene" && <SceneTemplatePicker send={send} />}

        {tab === "style" && (
          <>
            <PresetPicker />
            <IntensityDial send={send} />
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
          </>
        )}

        {tab === "inspector" && <GenerationInspector />}
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
