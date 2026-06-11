"use client";

import { X } from "lucide-react";

import { useVisualizerStore } from "@/stores/visualizer";

// Visible while a set replay is running: a small centered pill naming
// what's playing with an explicit exit. Stopping goes to idle (the canvas
// holds its last frame).
export const SetPlaybackHud = () => {
  const source = useVisualizerStore((s) => s.source);
  const stop = useVisualizerStore((s) => s.stopToIdle);

  if (source.kind !== "set") {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute left-1/2 top-6 z-40 flex -translate-x-1/2 items-center gap-3 rounded-full border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/85 px-4 py-2 backdrop-blur-md">
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85">
        replaying{source.name ? ` · ${source.name}` : ""}
      </span>
      <button
        type="button"
        onClick={stop}
        aria-label="exit playback"
        className="focus-ring flex items-center gap-1 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]"
      >
        <X className="size-3" strokeWidth={1.5} />
        exit
      </button>
    </div>
  );
};
