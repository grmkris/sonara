"use client";

import { useCallback } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";
import { TelemetryButton } from "@/components/visualizer/controls/telemetry-button";
import { useVisualizerStore } from "@/stores/visualizer";

export function HideToggle() {
  const uiVisible = useVisualizerStore((s) => s.uiVisible);
  const toggleUi = useVisualizerStore((s) => s.toggleUi);
  const setUiVisible = useVisualizerStore((s) => s.setUiVisible);

  useHotkey(
    HOTKEYS.toggleUi,
    useCallback(() => toggleUi(), [toggleUi]),
  );
  useHotkey(
    HOTKEYS.hideUi,
    useCallback(() => setUiVisible(false), [setUiVisible]),
  );

  const Icon = uiVisible ? EyeOff : Eye;

  return (
    <TelemetryButton
      onClick={toggleUi}
      aria-label={uiVisible ? "Hide interface" : "Show interface"}
      icon={<Icon className="size-3" strokeWidth={1.5} />}
      label={uiVisible ? "hide" : "show"}
    />
  );
}
