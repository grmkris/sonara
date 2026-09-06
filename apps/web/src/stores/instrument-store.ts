"use client";

import { DEFAULT_INSTRUMENT, InstrumentConfig } from "@sonara/shared";
import { create } from "zustand";

const KEY = "sonara_instrument_v1";
interface InstrumentState {
  config: InstrumentConfig;
  enabled: boolean;
  setConfig: (config: InstrumentConfig) => void;
  setEnabled: (enabled: boolean) => void;
}
export const useInstrumentStore = create<InstrumentState>((set) => ({
  config: structuredClone(DEFAULT_INSTRUMENT),
  enabled: true,
  setConfig: (config) => {
    const parsed = InstrumentConfig.parse(config);
    set({ config: parsed });
    try {
      localStorage.setItem(KEY, JSON.stringify(parsed));
    } catch {
      /* storage may be unavailable */
    }
  },
  setEnabled: (enabled) => {
    set({ enabled });
  },
}));
export const hydrateInstrument = (): void => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = InstrumentConfig.safeParse(raw ? JSON.parse(raw) : null);
    if (parsed.success) {
      useInstrumentStore.setState({ config: parsed.data });
    }
  } catch {
    /* keep the default instrument */
  }
};
