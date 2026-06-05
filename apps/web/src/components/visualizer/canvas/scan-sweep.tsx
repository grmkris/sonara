"use client";

import { useEffect, useState } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

export const ScanSweep = () => {
  const pulse = useVisualizerStore((s) => s.sweepPulse);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (pulse === 0) {
      return;
    }
    setActive(true);
    const t = setTimeout(() => setActive(false), 740);
    return () => clearTimeout(t);
  }, [pulse]);

  if (!active) {
    return null;
  }
  return <span aria-hidden className="ink-sweep" key={pulse} />;
};
