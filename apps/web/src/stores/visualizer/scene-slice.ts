import { defaultScene } from "@sonara/shared";
import type { SonaraSceneState } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

export type JobStatus = "idle" | "running" | "cancelled" | "error";

export interface SceneSlice {
  scene: SonaraSceneState;
  previousFrame: string | null;
  currentFrame: string | null;
  crossfadeStartedAt: number | null;
  status: JobStatus;
  statusMessage: string | null;
  connected: boolean;
  latestVersion: number;

  setScene: (state: SonaraSceneState) => void;
  pushFrame: (url: string, version: number) => void;
  setStatus: (s: JobStatus, msg?: string) => void;
  setConnected: (c: boolean) => void;
  resetFrameVersion: () => void;
}

export const createSceneSlice: StateCreator<
  VisualizerState,
  [],
  [],
  SceneSlice
> = (set, get) => ({
  connected: false,
  crossfadeStartedAt: null,
  currentFrame: null,
  latestVersion: 0,
  previousFrame: null,
  pushFrame: (url, version) => {
    if (version < get().latestVersion) {
      return;
    }
    // Deliberately do NOT reset crossfadeStartedAt here. If we null it, the
    // renderer branches to bleedT=1 until the new image actually decodes —
    // which guillotines any in-progress bleed the instant a new URL arrives.
    // markImageLoaded() is the sole writer, fired when the texture is actually
    // ready. Until then, the old bleed continues gracefully.
    set((s) => ({
      currentFrame: url,
      latestVersion: version,
      previousFrame: s.currentFrame,
    }));
  },
  // Zero the monotonic frame guard. Called when the frame *producer* changes
  // (client demo loop ↔ server live-gen, toggled via demo mode) so the new
  // producer's next frame is never rejected as "stale" by pushFrame's guard.
  resetFrameVersion: () => set({ latestVersion: 0 }),
  scene: { ...defaultScene },
  setConnected: (c) => set({ connected: c }),
  setScene: (state) => set({ scene: state }),
  setStatus: (status, message) => {
    set({ status, statusMessage: message ?? null });
    if (status === "running") {
      set((s) => ({ sweepPulse: s.sweepPulse + 1 }));
    }
  },
  status: "idle",
  statusMessage: null,
});
