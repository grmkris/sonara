"use client";

import { useEffect, useRef } from "react";
import { CENTER, DOT_R, RINGS, VIEWBOX } from "@/lib/brand";
import { useVisualizerStore } from "@/stores/visualizer";

// The Sonara mark — concentric sonar rings + a center dot, in currentColor so
// it inherits the surrounding text colour and carries no background. Pair it
// with the wordmark for a lockup.
//
// `reactive` wires the outer rings to live audio (RMS → `--amp`), the same
// signal that pulses the wordmark underline — so the ripple "breathes" with
// the music. Done via a ref + store subscription (no React re-render).
export function Mark({
  className,
  reactive = false,
}: {
  className?: string;
  reactive?: boolean;
}) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!reactive) return;
    const unsub = useVisualizerStore.subscribe((s, prev) => {
      if (s.audio.rms === prev.audio.rms) return;
      const el = ref.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(1, s.audio.rms));
      el.style.setProperty("--amp", clamped.toFixed(3));
    });
    return () => unsub();
  }, [reactive]);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      {RINGS.map((ring, i) => {
        // Outer two rings react to audio; the innermost stays solid as an
        // anchor. base..base+gain is the opacity range as --amp goes 0..1.
        const gain = i === 0 ? 0 : 0.45;
        const base = ring.o;
        return (
          <circle
            key={ring.r}
            cx={CENTER}
            cy={CENTER}
            r={ring.r}
            stroke="currentColor"
            strokeWidth={ring.w}
            style={
              reactive && gain > 0
                ? {
                    opacity: `calc(${base} + var(--amp, 0) * ${gain})`,
                    transition: "opacity 80ms linear",
                  }
                : { opacity: base }
            }
          />
        );
      })}
      <circle cx={CENTER} cy={CENTER} r={DOT_R} fill="currentColor" />
    </svg>
  );
}
