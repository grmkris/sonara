"use client";

import { useEffect, useRef, useState } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";

// Paper-colored circle that expands and fades on each audio.onset rising edge.
// Up to 4 concurrent rings; oldest drops off.
interface Ring {
  id: number;
  born: number;
}
const RING_MS = 520;
const MAX_RINGS = 4;

export function OnsetRing() {
  const [rings, setRings] = useState<Ring[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const unsub = useVisualizerStore.subscribe((state, prev) => {
      // Rising-edge only: fire when onset flips false → true.
      if (!state.audio.onset || prev.audio.onset) return;
      idRef.current += 1;
      const ring: Ring = { id: idRef.current, born: performance.now() };
      setRings((r) => [...r.slice(-(MAX_RINGS - 1)), ring]);
    });
    return unsub;
  }, []);

  // Garbage-collect expired rings; avoids unbounded state growth if onsets stall.
  useEffect(() => {
    if (rings.length === 0) return;
    const t = setTimeout(() => {
      const cutoff = performance.now() - RING_MS - 100;
      setRings((r) => r.filter((x) => x.born > cutoff));
    }, RING_MS + 120);
    return () => clearTimeout(t);
  }, [rings]);

  if (rings.length === 0) return null;

  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      {rings.map((r) => (
        <circle
          key={r.id}
          cx="50"
          cy="50"
          r="8"
          fill="none"
          stroke="var(--paper)"
          strokeWidth="0.25"
          style={{
            animation: `onset-ring ${RING_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) forwards`,
            opacity: 0,
          }}
        />
      ))}
    </svg>
  );
}
