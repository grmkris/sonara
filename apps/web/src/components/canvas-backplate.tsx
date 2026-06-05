"use client";

import { useEffect } from "react";

import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { useDemoFrameLoop } from "@/hooks/use-demo-frame-loop";
import { useWsSession } from "@/hooks/use-ws-session";
import { useVisualizerStore } from "@/stores/visualizer";

// Shared marketing backplate for the landing + about pages. The same
// SonaraCanvas the visualiser uses, mounted as a fixed full-viewport plate so
// it stays visible while copy scrolls over it. Demo is client-native:
// useDemoFrameLoop() cycles a deck's static frames into the canvas (with the
// displacement-shader transitions) — no server/WS frames and no audio.
//
// A single `.page-veil` sits between the canvas (z-0, behind the grain at z-1)
// and the page content (z-10): one uniform ink wash so the backplate reads as
// ONE continuous image top-to-bottom, with no per-section panel seam.
export function CanvasBackplate() {
  useWsSession();
  useDemoFrameLoop();

  // Self-start demo regardless of auth/connectivity. The anon WS snapshot sets
  // these for most visitors, but signed-in or offline visitors get no anon pin
  // — without this the backplate would be black. Only fills gaps (won't
  // override a deck the snapshot already chose).
  useEffect(() => {
    const st = useVisualizerStore.getState();
    if (!st.demoMode) {
      st.setDemoMode(true);
    }
    if (!st.demoDeck) {
      st.setDemoDeck("liquid");
    }
  }, []);

  return (
    <>
      <div className="pointer-events-none fixed inset-0 z-0">
        <SonaraCanvas />
      </div>
      <div aria-hidden className="grain-overlay" />
      <div
        aria-hidden
        className="page-veil pointer-events-none fixed inset-0 z-[2]"
      />
    </>
  );
}
