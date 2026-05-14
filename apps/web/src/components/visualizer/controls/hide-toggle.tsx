"use client";

import { useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useHotkey } from "@/hooks/use-hotkey";
import { useVisualizerStore } from "@/stores/visualizer";
import { cn } from "@/lib/utils";

export function HideToggle() {
  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const toggleUi = useVisualizerStore((s) => s.toggleUi);
  const setUiVisible = useVisualizerStore((s) => s.setUiVisible);

  useHotkey(
    "h",
    useCallback(() => toggleUi(), [toggleUi]),
  );
  useHotkey(
    "Escape",
    useCallback(() => setUiVisible(false), [setUiVisible]),
  );

  const Icon = uiVisible ? EyeOff : Eye;

  return (
    <button
      type="button"
      onClick={toggleUi}
      aria-label={uiVisible ? "Hide interface" : "Show interface"}
      className={cn(
        "pointer-events-auto flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]",
      )}
    >
      <Icon className="size-3" strokeWidth={1.5} />
      <span className="hidden sm:inline">{uiVisible ? "hide · h" : "show · h"}</span>
    </button>
  );
}
