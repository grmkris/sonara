"use client";

import { DEFAULT_TOUCH, EngineConfig } from "@sonara/shared";
import { create } from "zustand";

const KEY = "sonara_experience_v4";
export const RESPONSIVE_LIVE_ENABLED = true;
const liveConfig = (config: EngineConfig): EngineConfig => {
  if (!RESPONSIVE_LIVE_ENABLED || config.version === 4) {
    return config;
  }
  if (config.version === 2 || config.version === 3) {
    return {
      ...config,
      response: "response" in config ? config.response : 0.7,
      version: 4,
    };
  }
  return { ...DEFAULT_TOUCH, palette: config.palette, seed: config.seed };
};
interface InstrumentState {
  config: EngineConfig;
  enabled: boolean;
  setConfig: (config: EngineConfig) => void;
  setEnabled: (enabled: boolean) => void;
}
export const useInstrumentStore = create<InstrumentState>((set) => ({
  config: structuredClone(DEFAULT_TOUCH),
  enabled: true,
  setConfig: (config) => {
    const parsed = EngineConfig.parse(config);
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
    const raw =
      localStorage.getItem(KEY) ??
      localStorage.getItem("sonara_experience_v3") ??
      localStorage.getItem("sonara_experience_v2");
    const parsed = EngineConfig.safeParse(raw ? JSON.parse(raw) : null);
    if (parsed.success) {
      useInstrumentStore.getState().setConfig(liveConfig(parsed.data));
    }
  } catch {
    /* keep the default instrument */
  }
};
