"use client";

import { useEffect } from "react";

import { SonaraCanvas } from "@/components/visualizer/canvas/sonara-canvas";
import { usePlaybackLoop } from "@/hooks/use-playback-loop";
import { useVisualizerStore } from "@/stores/visualizer";

// Shared marketing backplate for the landing + about pages. The same
// SonaraCanvas the visualiser uses, mounted as a fixed full-viewport plate so
// it stays visible while copy scrolls over it. Playback is client-native:
// usePlaybackLoop() cycles a deck's static frames into the canvas (with the
// displacement-shader transitions) — no server/WS frames and no audio.
//
// A single `.page-veil` sits between the canvas (z-0, behind the grain at z-1)
// and the page content (z-10): one uniform ink wash so the backplate reads as
// ONE continuous image top-to-bottom, with no per-section panel seam.
export const CanvasBackplate = () => {
  // NO WebSocket here, deliberately: the backplate is fully client-native
  // (static deck manifests), and a WS would attach this tab as the visitor's
  // default-stage SCREEN — a signed-in user browsing the homepage would take
  // over their own projector mid-gig.
  usePlaybackLoop();

  // Self-start playback regardless of auth/connectivity — without this the
  // backplate would be black. Only fills gaps (won't override a deck a
  // previous page already chose).
  useEffect(() => {
    const st = useVisualizerStore.getState();
    if (st.source.kind === "idle" || st.source.kind === "live") {
      st.setSource({ deck: "liquid", kind: "deck" });
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
};
