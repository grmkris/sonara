import { DECK_KEYS } from "@sonara/shared";
import type { DeckKey } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

export const DEMO_MODE_KEY = "viz_demo_mode";
export const DEMO_DECK_KEY = "viz_demo_deck";

export interface DemoSlice {
  demoMode: boolean;
  demoDeck: DeckKey | null;

  setDemoMode: (on: boolean) => void;
  setDemoDeck: (deck: DeckKey | null) => void;
}

export const createDemoSlice: StateCreator<
  VisualizerState,
  [],
  [],
  DemoSlice
> = (set) => ({
  demoDeck: null,
  demoMode: false,
  setDemoDeck: (deck) => {
    set({ demoDeck: deck });
    if (typeof window !== "undefined") {
      if (deck) {
        window.localStorage.setItem(DEMO_DECK_KEY, deck);
      } else {
        window.localStorage.removeItem(DEMO_DECK_KEY);
      }
    }
  },
  setDemoMode: (on) => {
    set({ demoMode: on });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DEMO_MODE_KEY, on ? "1" : "0");
    }
  },
});

export const readDemoPrefs = (): {
  demoMode: boolean;
  demoDeck: DeckKey | null;
} => {
  if (typeof window === "undefined") {
    return { demoDeck: null, demoMode: false };
  }
  const m = window.localStorage.getItem(DEMO_MODE_KEY);
  const d = window.localStorage.getItem(DEMO_DECK_KEY);
  const deck =
    d && (DECK_KEYS as readonly string[]).includes(d) ? (d as DeckKey) : null;
  return { demoDeck: deck, demoMode: m === "1" };
};
