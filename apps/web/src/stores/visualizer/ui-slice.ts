import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

export const UI_VISIBLE_KEY = "sonara.uiVisible";

export interface UiSlice {
  uiVisible: boolean;
  sweepPulse: number;
  /** performance.now() captured once at store init — derived as MM:SS for the
   *  uptime readout in the status HUD. Survives across re-renders but resets
   *  on full page reload, which matches user mental model of "session time". */
  sessionStartedAt: number;

  toggleUi: () => void;
  setUiVisible: (v: boolean) => void;
}

export const createUiSlice: StateCreator<VisualizerState, [], [], UiSlice> = (
  set
) => ({
  sessionStartedAt: typeof performance === "undefined" ? 0 : performance.now(),
  setUiVisible: (v) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UI_VISIBLE_KEY, v ? "1" : "0");
    }
    set({ uiVisible: v });
  },
  sweepPulse: 0,
  toggleUi: () =>
    set((s) => {
      const next = !s.uiVisible;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UI_VISIBLE_KEY, next ? "1" : "0");
      }
      return { uiVisible: next };
    }),
  uiVisible: true,
});
