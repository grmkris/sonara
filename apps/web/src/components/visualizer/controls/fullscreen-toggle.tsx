"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";
import { TelemetryButton } from "@/components/visualizer/controls/telemetry-button";

export function FullscreenToggle() {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    setIsFs(Boolean(document.fullscreenElement));
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  useHotkey(HOTKEYS.fullscreen, toggle);

  const Icon = isFs ? Minimize2 : Maximize2;

  return (
    <TelemetryButton
      onClick={toggle}
      aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
      icon={<Icon className="size-3" strokeWidth={1.5} />}
      label={isFs ? "exit · f" : "full · f"}
    />
  );
}
