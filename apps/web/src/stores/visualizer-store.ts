import { create } from "zustand";
import {
  type AudioFeatures,
  type DreamSceneState,
  type DreamSceneStatePatch,
  defaultAudio,
  defaultScene,
} from "@music-visualizer/shared";

export type JobStatus = "idle" | "running" | "cancelled" | "error";
export type TriggerReason =
  | "pause"
  | "semantic"
  | "section"
  | "periodic"
  | "commit"
  | "voice";

export interface TriggerEntry {
  id: number;
  reason: TriggerReason;
  version: number;
  at: number;
}

const TRIGGER_LOG_MAX = 16;
const UI_VISIBLE_KEY = "dream.uiVisible";

// Always `true` on first render (server + client) so SSR hydrates cleanly. The
// stored preference is applied post-mount via `hydrateUiVisible()`.
export function hydrateUiVisible(): void {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(UI_VISIBLE_KEY);
  if (raw === null) return;
  useVisualizerStore.setState({ uiVisible: raw !== "0" });
}

export interface VisualizerState {
  scene: DreamSceneState;
  audio: AudioFeatures;
  previousFrame: string | null;
  currentFrame: string | null;
  crossfadeStartedAt: number | null;
  status: JobStatus;
  statusMessage: string | null;
  connected: boolean;

  uiVisible: boolean;
  commitPulse: number;
  sweepPulse: number;
  latestVersion: number;
  triggerLog: TriggerEntry[];

  patchSceneLocal: (patch: DreamSceneStatePatch) => void;
  setScene: (state: DreamSceneState) => void;
  setAudio: (f: AudioFeatures) => void;
  pushFrame: (url: string, version: number) => void;
  setStatus: (s: JobStatus, msg?: string) => void;
  setConnected: (c: boolean) => void;

  toggleUi: () => void;
  setUiVisible: (v: boolean) => void;
  pulseCommit: () => void;
  pulseSweep: () => void;
  pushTrigger: (reason: TriggerReason, version: number) => void;
}

export const useVisualizerStore = create<VisualizerState>()((set, get) => ({
  scene: { ...defaultScene },
  audio: { ...defaultAudio },
  previousFrame: null,
  currentFrame: null,
  crossfadeStartedAt: null,
  status: "idle",
  statusMessage: null,
  connected: false,

  uiVisible: true,
  commitPulse: 0,
  sweepPulse: 0,
  latestVersion: 0,
  triggerLog: [],

  patchSceneLocal: (patch) =>
    set((s) => ({ scene: { ...s.scene, ...patch } })),
  setScene: (state) => set({ scene: state }),
  setAudio: (f) => set({ audio: f }),
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

  toggleUi: () =>
    set((s) => {
      const next = !s.uiVisible;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UI_VISIBLE_KEY, next ? "1" : "0");
      }
      return { uiVisible: next };
    }),
  setUiVisible: (v) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UI_VISIBLE_KEY, v ? "1" : "0");
    }
    set({ uiVisible: v });
  },
  pulseCommit: () => set((s) => ({ commitPulse: s.commitPulse + 1 })),
  pulseSweep: () => set((s) => ({ sweepPulse: s.sweepPulse + 1 })),
  pushTrigger: (reason, version) =>
    set((s) => {
      const entry: TriggerEntry = {
        id: (s.triggerLog[0]?.id ?? 0) + 1,
        reason,
        version,
        at: Date.now(),
      };
      return { triggerLog: [entry, ...s.triggerLog].slice(0, TRIGGER_LOG_MAX) };
    }),
}));

/**
 * Crossfade timing is driven by the `<img>.onLoad` event rather than the moment
 * a URL arrives. This avoids the black flash when a large fal image hasn't
 * decoded by the time the crossfade window (800 ms) elapses.
 */
export function markImageLoaded(): void {
  useVisualizerStore.setState({ crossfadeStartedAt: performance.now() });
}
