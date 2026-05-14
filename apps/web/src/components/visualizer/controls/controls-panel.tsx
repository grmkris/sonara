"use client";

import type { SonaraSceneState } from "@sonara/shared";
import type { SessionSend } from "@/lib/session-actions";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DemoModeToggle } from "@/components/visualizer/controls/demo-mode-toggle";
import { IntensityDial } from "@/components/visualizer/controls/intensity-dial";
import { PresetPicker } from "@/components/visualizer/controls/preset-picker";
import { SceneTemplatePicker } from "@/components/visualizer/controls/scene-template-picker";
import { GenerationInspector } from "@/components/visualizer/controls/generation-inspector";
import { SliderRow } from "@/components/visualizer/controls/slider-row";
import { useVisualizerStore, type ConsoleTab } from "@/stores/visualizer";
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
    <div className="relative flex flex-col gap-5 rounded-sm border border-[color:var(--hairline)]/25 p-4">
      <DemoModeToggle send={send} />

      <div
        aria-hidden
        className="h-px w-full bg-[color:var(--hairline)]/20"
      />

      <Tabs
        value={tab}
        onValueChange={(v) => pickTab(v as ConsoleTab)}
        className="gap-4"
      >
        <TabsList
          variant="line"
          className="h-auto justify-start gap-5 bg-transparent p-0"
        >
          {TABS.map((t) => (
            <TabsTrigger
              key={t.id}
              value={t.id}
              className={cn(
                "font-serif h-auto flex-none rounded-none px-0 py-1 text-[13px] italic",
                "border-b border-transparent text-[color:var(--stone)] shadow-none",
                "hover:text-[color:var(--paper)]/85",
                "data-[state=active]:border-[color:var(--paper)] data-[state=active]:bg-transparent data-[state=active]:text-[color:var(--paper)] data-[state=active]:shadow-none",
                "after:hidden",
              )}
            >
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="scene" className="panel-reveal flex flex-col gap-5">
          <SceneTemplatePicker send={send} />
        </TabsContent>

        <TabsContent value="style" className="panel-reveal flex flex-col gap-5">
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
        </TabsContent>

        <TabsContent
          value="inspector"
          className="panel-reveal flex flex-col gap-5"
        >
          <GenerationInspector />
        </TabsContent>
      </Tabs>
    </div>
  );
}

