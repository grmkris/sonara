"use client";

import { useEffect, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer";

// Formatted MM:SS (or H:MM:SS past one hour) session uptime, updated 1Hz.
// Derived from the store's sessionStartedAt timestamp.
export function useUptime(): string {
  const startedAt = useVisualizerStore((s) => s.sessionStartedAt);
  const [now, setNow] = useState(() =>
    typeof performance !== "undefined" ? performance.now() : 0,
  );

  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return formatUptime(seconds);
}

function formatUptime(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
