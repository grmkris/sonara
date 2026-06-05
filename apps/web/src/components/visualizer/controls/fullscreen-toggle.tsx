"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { TelemetryButton } from "@/components/visualizer/controls/telemetry-button";
import { useHotkey } from "@/hooks/use-hotkey";
import { HOTKEYS } from "@/lib/hotkeys";

export const FullscreenToggle = () => {
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    setIsFs(Boolean(document.fullscreenElement));
    const onChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      // oxlint-disable-next-line prefer-await-to-then -- fire-and-forget inside a sync callback; awaiting would change control flow
      document.exitFullscreen().catch(() => {
        // noop — ignore fullscreen rejection
      });
    } else {
      // oxlint-disable-next-line prefer-await-to-then -- fire-and-forget inside a sync callback; awaiting would change control flow
      document.documentElement.requestFullscreen().catch(() => {
        // noop — ignore fullscreen rejection
      });
    }
  }, []);

  useHotkey(HOTKEYS.fullscreen, toggle);

  const Icon = isFs ? Minimize2 : Maximize2;

  return (
    <TelemetryButton
      onClick={toggle}
      aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
      icon={<Icon className="size-3" strokeWidth={1.5} />}
      label={isFs ? "exit" : "fullscreen"}
    />
  );
};
