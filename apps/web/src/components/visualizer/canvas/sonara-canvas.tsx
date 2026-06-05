"use client";

import { useEffect, useState } from "react";

import { CanvasGrain } from "@/components/visualizer/audio/canvas-grain";
import { CanvasOscilloscope } from "@/components/visualizer/audio/canvas-oscilloscope";
import { DisplacementCanvas } from "@/components/visualizer/canvas/displacement-canvas";
import { InkDrops } from "@/components/visualizer/canvas/ink-drops";
import { isWebgl2Available } from "@/lib/render/webgl-util";
import { cn } from "@/lib/utils";

// WebGL2-only renderer. The previous CSS fallback path drifted from the WebGL
// pipeline (missed reveal, presets, RD, glitch-peek) and was deleted.
// prefers-reduced-motion is honoured downstream via intensity damping.
//
// Why DOM overlays coexist with shader uniforms of similar names:
//   - <CanvasGrain/>: SVG fractalNoise tile, mix-blend-overlay. Adds DOM-level
//     paper tooth that the shader's procedural `uGrain` can't replicate.
//   - <InkDrops/>: 2d-canvas peak-hold sumi blobs, audio-reactive in DOM space.
//     Shader has no equivalent — distinct effect.
//   - <CanvasOscilloscope/>: waveform overlay drawn on a 2d canvas. Pure DOM.
//   - .vignette-mask div: CSS radial mask. Shader's `uVignette` darkens
//     compositing within the texture; this mask sits over the entire stack
//     including overlays, so it's not redundant.
// Audit pass concluded each is load-bearing in its own way. Keep all four.
// `dimmed` desaturates + darkens the whole stack while no audio source is
// connected, so the deck cycle reads as "asleep" until the visitor brings
// sound — then it eases back to full and "wakes up" (see /play).
const Webgl2RequiredOverlay = () => (
  <div className="absolute inset-0 flex items-center justify-center bg-[color:var(--ink)] text-[color:var(--paper)]">
    <div className="max-w-md p-8 text-center font-serif">
      <p className="mb-2 text-2xl italic">WebGL2 required</p>
      <p className="text-sm opacity-70">
        The visualiser needs a browser with WebGL2 support. Try the latest
        Chrome, Safari, Firefox, or Edge.
      </p>
    </div>
  </div>
);

export const SonaraCanvas = ({ dimmed = false }: { dimmed?: boolean }) => {
  const [hasWebgl2, setHasWebgl2] = useState<boolean | null>(null);

  useEffect(() => {
    setHasWebgl2(isWebgl2Available());
  }, []);

  if (hasWebgl2 === false) {
    return <Webgl2RequiredOverlay />;
  }

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden bg-[color:var(--ink)] transition-[filter] duration-1000 ease-out",
        dimmed && "[filter:brightness(0.5)_saturate(0.6)]"
      )}
      style={{ isolation: "isolate" }}
    >
      <DisplacementCanvas />
      <CanvasGrain />
      <InkDrops />
      <CanvasOscilloscope />
      <div aria-hidden className="vignette-mask absolute inset-0" />
    </div>
  );
};
