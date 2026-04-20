"use client";

import { useEffect, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";

export function Hanko() {
  const pulse = useVisualizerStore((s) => s.commitPulse);
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
      className="hanko-press pointer-events-none fixed bottom-12 right-10 z-40 flex h-11 w-11 items-center justify-center"
      style={{
        background: "var(--hanko)",
        color: "var(--paper)",
        boxShadow:
          "0 0 0 1px color-mix(in srgb, var(--hanko) 70%, black), inset 0 0 0 2px color-mix(in srgb, var(--hanko) 50%, black)",
      }}
    >
      <span
        className="font-mincho select-none"
        style={{ fontSize: "22px", fontWeight: 700, lineHeight: 1 }}
      >
        印
      </span>
    </div>
  );
}
