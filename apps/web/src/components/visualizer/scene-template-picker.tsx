"use client";

import { useCallback } from "react";
import type { ClientEvent, DreamSceneState } from "@music-visualizer/shared";
import { SCENE_TEMPLATES } from "@music-visualizer/shared";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { cn } from "@/lib/utils";

interface SceneTemplatePickerProps {
  send: (e: ClientEvent) => void;
}

// Horizontal chip-row of 8 scene templates. One click loads the template's
// four text fields via scene.patch. Intensity dial + image-feel sliders +
// render presets are unaffected — templates only shape the prompt.
//
// Not to be confused with `PresetPicker` (render-preset / shader style) —
// this component picks *prompt content*; that one picks *visual style*.
export function SceneTemplatePicker({ send }: SceneTemplatePickerProps) {
  const scene = useVisualizerStore((s) => s.scene);

  const onPick = useCallback(
    (patch: Partial<DreamSceneState>) => {
      send({ type: "scene.patch", patch });
    },
    [send],
  );

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
        scenes
      </span>
      <div className="flex flex-wrap gap-1.5">
        {SCENE_TEMPLATES.map((t) => {
          const active = scene.subject === t.scene.subject;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => onPick(t.scene)}
              className={cn(
                "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
                active
                  ? "text-[color:var(--paper)] border-[color:var(--paper)]"
                  : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
