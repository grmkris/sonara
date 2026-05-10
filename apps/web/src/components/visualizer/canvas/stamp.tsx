"use client";

import { useEffect, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";

// Commit stamp — editorial print-mark that presses in on each commit pulse.
// Replaces the former Hanko component. Hairline circle outline in --signal
// with the current version number stamped inside in Plex Mono. Same
// press-and-retreat timing as before.
export function Stamp() {
  const pulse = useVisualizerStore((s) => s.commitPulse);
  const version = useVisualizerStore((s) => s.latestVersion);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pulse === 0) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 1100);
    return () => clearTimeout(t);
  }, [pulse]);

  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="stamp-press pointer-events-none fixed right-10 bottom-12 z-40 flex size-11 items-center justify-center rounded-full"
      style={{
        border: "1px solid var(--signal)",
        color: "var(--signal)",
        boxShadow: "0 0 0 3px color-mix(in srgb, var(--signal) 12%, transparent)",
      }}
    >
      <span
        className="font-mono nums select-none"
        style={{ fontSize: "11px", fontWeight: 500, letterSpacing: "0.04em" }}
      >
        {version.toString().padStart(2, "0")}
      </span>
    </div>
  );
}
