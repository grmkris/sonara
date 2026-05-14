"use client";

import { useCallback, useEffect, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { useHotkey } from "@/hooks/use-hotkey";
import { cn } from "@/lib/utils";

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

  useHotkey("f", toggle);

  const Icon = isFs ? Minimize2 : Maximize2;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isFs ? "Exit fullscreen" : "Enter fullscreen"}
      className={cn(
        "pointer-events-auto flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]",
      )}
    >
      <Icon className="size-3" strokeWidth={1.5} />
      <span className="hidden sm:inline">{isFs ? "exit · f" : "full · f"}</span>
    </button>
  );
}
