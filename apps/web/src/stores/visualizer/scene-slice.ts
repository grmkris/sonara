import type { StateCreator } from "zustand";
import { type DreamSceneState, defaultScene } from "@music-visualizer/shared";
import type { VisualizerState } from "./types";

export type JobStatus = "idle" | "running" | "cancelled" | "error";

export interface SceneSlice {
  scene: DreamSceneState;
  previousFrame: string | null;
  currentFrame: string | null;
  crossfadeStartedAt: number | null;
  status: JobStatus;
  statusMessage: string | null;
  connected: boolean;
  latestVersion: number;

  setScene: (state: DreamSceneState) => void;
  pushFrame: (url: string, version: number) => void;
  setStatus: (s: JobStatus, msg?: string) => void;
  setConnected: (c: boolean) => void;
}

export const createSceneSlice: StateCreator<
  VisualizerState,
  [],
  [],
  SceneSlice
> = (set, get) => ({
  scene: { ...defaultScene },
  previousFrame: null,
  currentFrame: null,
  crossfadeStartedAt: null,
  status: "idle",
  statusMessage: null,
  connected: false,
  latestVersion: 0,

  setScene: (state) => set({ scene: state }),
  pushFrame: (url, version) => {
    if (version < get().latestVersion) return;
    // Deliberately do NOT reset crossfadeStartedAt here. If we null it, the
    // renderer branches to bleedT=1 until the new image actually decodes —
    // which guillotines any in-progress bleed the instant a new URL arrives.
    // markImageLoaded() is the sole writer, fired when the texture is actually
    // ready. Until then, the old bleed continues gracefully.
    set((s) => ({
      previousFrame: s.currentFrame,
      currentFrame: url,
      latestVersion: version,
    }));
  },
  setStatus: (status, message) => {
    set({ status, statusMessage: message ?? null });
    if (status === "running") set((s) => ({ sweepPulse: s.sweepPulse + 1 }));
  },
  setConnected: (c) => set({ connected: c }),
});
