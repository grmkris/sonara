import type { StateCreator } from "zustand";
import type { VisualizerState } from "./types";

export const UI_VISIBLE_KEY = "sonara.uiVisible";
export const CONSOLE_TAB_KEY = "sonara.consoleTab";

export type ConsoleTab = "scene" | "style" | "inspector";

export interface UiSlice {
  uiVisible: boolean;
  consoleTab: ConsoleTab;
  sweepPulse: number;
  /** performance.now() captured once at store init — derived as MM:SS for the
   *  uptime readout in the status HUD. Survives across re-renders but resets
   *  on full page reload, which matches user mental model of "session time". */
  sessionStartedAt: number;

  toggleUi: () => void;
  setUiVisible: (v: boolean) => void;
  setConsoleTab: (t: ConsoleTab) => void;
}

export const createUiSlice: StateCreator<VisualizerState, [], [], UiSlice> = (
  set,
) => ({
  uiVisible: true,
  consoleTab: "scene",
  sweepPulse: 0,
  sessionStartedAt:
    typeof performance !== "undefined" ? performance.now() : 0,

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
  setConsoleTab: (t) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CONSOLE_TAB_KEY, t);
    }
    set({ consoleTab: t });
  },
});
