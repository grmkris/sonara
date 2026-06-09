"use client";

import {
  RENDER_RESOLUTIONS,
  TEXT_MODELS,
  TEXT_MODEL_KEYS,
} from "@sonara/shared";
import type { RenderResolution, TextModelKey } from "@sonara/shared";
import { useCallback } from "react";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { SessionSend } from "@/lib/session-actions";
import { cn } from "@/lib/utils";
import { useVisualizerStore } from "@/stores/visualizer";

interface ModelPickerProps {
  send: SessionSend;
}

const itemClass = cn(
  "focus-ring font-sans h-auto rounded-sm border border-[color:var(--hairline)]/30 bg-transparent px-1.5 py-0.5 text-[10px] uppercase tracking-[0.14em] text-[color:var(--stone)] shadow-none transition-colors",
  "hover:bg-transparent hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
  "data-pressed:bg-[color:var(--paper)] data-pressed:text-[color:var(--ink)] data-pressed:border-[color:var(--paper)]"
);

// A/B switcher for the live-session image model + render resolution. Realtime
// models (lightning-sdxl / lcm) stream over a warm websocket (~150-300ms);
// klein is the queue-based quality baseline. Picks are client-authoritative —
// stored locally and re-sent to the server on (re)connect (see use-ws-session).
export const ModelPicker = ({ send }: ModelPickerProps) => {
  const model = useVisualizerStore((s) => s.model);
  const resolution = useVisualizerStore((s) => s.resolution);
  const setModel = useVisualizerStore((s) => s.setModel);
  const setResolution = useVisualizerStore((s) => s.setResolution);

  const onPickModel = useCallback(
    (next: string | undefined) => {
      if (!next || next === model) {
        return;
      }
      const key = next as TextModelKey;
      // eslint-disable-next-line no-console
      console.info(
        `%c[sonara] model.set%c → ${key} (${TEXT_MODELS[key].falId}, ${TEXT_MODELS[key].transport})`,
        "color:#c39",
        "color:inherit"
      );
      setModel(key);
      send({ model: key, type: "model.set" });
    },
    [model, send, setModel]
  );

  const onPickResolution = useCallback(
    (next: string | undefined) => {
      if (!next) {
        return;
      }
      const value = Number(next) as RenderResolution;
      if (value === resolution) {
        return;
      }
      // eslint-disable-next-line no-console
      console.info(
        `%c[sonara] resolution.set%c → ${value}²`,
        "color:#c39",
        "color:inherit"
      );
      setResolution(value);
      send({ resolution: value, type: "resolution.set" });
    },
    [resolution, send, setResolution]
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <span className="font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
          engine · a/b
        </span>
        <ToggleGroup
          aria-label="image model"
          className="flex flex-wrap justify-start gap-1.5"
          onValueChange={(arr) => onPickModel(arr.at(-1))}
          spacing={6}
          value={[model]}
        >
          {TEXT_MODEL_KEYS.map((key) => (
            <ToggleGroupItem
              aria-label={TEXT_MODELS[key].label}
              className={itemClass}
              key={key}
              title={TEXT_MODELS[key].blurb}
              value={key}
            >
              {TEXT_MODELS[key].label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex items-center gap-2">
        <span className="font-sans text-[9px] uppercase tracking-[0.28em] text-[color:var(--stone)]">
          res
        </span>
        <ToggleGroup
          aria-label="render resolution"
          className="flex flex-wrap justify-start gap-1.5"
          onValueChange={(arr) => onPickResolution(arr.at(-1))}
          spacing={6}
          value={[String(resolution)]}
        >
          {RENDER_RESOLUTIONS.map((px) => (
            <ToggleGroupItem
              aria-label={`${px} pixels`}
              className={itemClass}
              key={px}
              value={String(px)}
            >
              {px}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
};
