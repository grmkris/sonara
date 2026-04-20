"use client";

import { useEffect, useRef } from "react";
import { useVisualizerStore } from "@/stores/visualizer-store";
import { damp } from "@/lib/render/damp";

// Ink-wash horizontal meters. The fill is a cream→transparent gradient whose
// width damps toward the audio feature; the trailing edge mask gives it a
// watercolor feel. Onsets briefly tip the bar to hanko red.
const BARS: { key: "bass" | "mids" | "treble" | "rms"; label: string; scale: number }[] = [
  { key: "bass",   label: "BASS", scale: 1.0 },
  { key: "mids",   label: "MID",  scale: 1.0 },
  { key: "treble", label: "HIGH", scale: 1.0 },
  { key: "rms",    label: "RMS",  scale: 1.6 },
];

export function AudioMeter() {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  const dampedRef = useRef<Record<string, number>>({
    bass: 0, mids: 0, treble: 0, rms: 0,
  });
  const flashUntilRef = useRef(0);

  useEffect(() => {
    let raf = 0;
    let lastOnset = false;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const a = useVisualizerStore.getState().audio;
      const now = performance.now();
      if (a.onset && !lastOnset) flashUntilRef.current = now + 80;
      lastOnset = a.onset;
      const flashing = now < flashUntilRef.current;
      for (const b of BARS) {
        const raw = Math.min(1, a[b.key] * b.scale);
        dampedRef.current[b.key] = damp(
          dampedRef.current[b.key] ?? 0,
          raw,
          0.2,
        );
        const el = refs.current[b.key];
        if (!el) continue;
        const pct = (dampedRef.current[b.key] ?? 0) * 100;
        el.style.width = `${pct.toFixed(1)}%`;
        el.style.background = flashing
          ? "linear-gradient(90deg, transparent, color-mix(in srgb, var(--hanko) 80%, transparent) 70%, var(--hanko))"
          : "linear-gradient(90deg, transparent, color-mix(in srgb, var(--paper) 55%, transparent) 55%, var(--paper))";
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="flex items-center gap-6">
      {BARS.map((b) => (
        <div key={b.key} className="flex flex-1 items-center gap-2">
          <span className="font-plex w-9 text-[9px] tracking-[0.2em] text-[color:var(--stone)]">
            {b.label}
          </span>
          <div className="relative h-px flex-1 bg-[color:var(--hairline)]/30">
            <div
              ref={(el) => {
                refs.current[b.key] = el;
              }}
              className="absolute inset-y-0 left-0"
              style={{
                width: "0%",
                willChange: "width, background",
                maskImage:
                  "linear-gradient(90deg, transparent, black 20%, black)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
