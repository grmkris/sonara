"use client";

import { Palette } from "lucide-react";
import { useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FeelSliders } from "@/components/visualizer/controls/feel-sliders";
import { PresetPicker } from "@/components/visualizer/controls/preset-picker";
import { useVisualizerStore } from "@/stores/visualizer";

// The render-preset surface, demoted from a resident 23-chip wall to a
// one-tap popover off the transport card. Looks mostly arrive baked into
// decks/sets now — manual preset surfing is the exception, so it lives one
// click away. PresetPicker is fully client-local (preset-slice localStorage;
// the cycle/section timers live in the slice), so relocating it changes no
// behavior.
export const LookPopover = () => {
  const [open, setOpen] = useState(false);
  const preset = useVisualizerStore((s) => s.preset);
  const label = preset.replaceAll("_", " ");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="edit the look"
          className="focus-ring flex items-center gap-1.5 rounded-sm border border-[color:var(--hairline)]/30 px-2 py-1.5 font-sans text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/60"
        >
          <Palette
            className="size-3 text-[color:var(--stone)]"
            strokeWidth={1.5}
          />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-72 p-4">
        <PresetPicker />
        <div
          aria-hidden
          className="my-3 h-px w-full bg-[color:var(--hairline)]/20"
        />
        <span className="font-sans text-[9px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          feel
        </span>
        <div className="mt-2">
          <FeelSliders />
        </div>
      </PopoverContent>
    </Popover>
  );
};
