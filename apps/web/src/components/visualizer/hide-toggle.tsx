"use client";

import { useCallback } from "react";
import { useHotkey } from "@/hooks/use-hotkey";
import { useVisualizerStore } from "@/stores/visualizer-store";
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

  return (
    <button
      type="button"
      onClick={toggleUi}
      aria-label={uiVisible ? "Hide interface" : "Show interface"}
      className={cn(
        "pointer-events-auto flex items-baseline gap-2 font-kaku text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]",
        // When UI is hidden, this button stays visible (opacity handled by
        // parent wrapper, which excludes this element).
      )}
    >
      <span className="font-mincho text-[13px] normal-case tracking-normal text-[color:var(--paper)]">
        {uiVisible ? "隠" : "現"}
      </span>
      <span>{uiVisible ? "hide · h" : "show · h"}</span>
    </button>
  );
}
