import type { StateCreator } from "zustand";
import type { VisualizerState } from "./types";

export const UI_VISIBLE_KEY = "dream.uiVisible";

export interface UiSlice {
  uiVisible: boolean;
  commitPulse: number;
  sweepPulse: number;

  toggleUi: () => void;
  setUiVisible: (v: boolean) => void;
  pulseCommit: () => void;
}

export const createUiSlice: StateCreator<VisualizerState, [], [], UiSlice> = (
  set,
) => ({
  uiVisible: true,
  commitPulse: 0,
  sweepPulse: 0,

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
});
