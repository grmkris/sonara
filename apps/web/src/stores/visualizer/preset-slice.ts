import type { StateCreator } from "zustand";

import { BASE, PRESET_NAMES } from "@/lib/render/presets";
import type { PresetConfig, PresetName } from "@/lib/render/presets";

import type { VisualizerState } from "./types";

export const PRESET_KEY = "sonara.preset";
export const PRESET_MODE_KEY = "sonara.presetMode";

export type PresetMode = "manual" | "cycle" | "section" | "llm";

// The user-tunable subset of PresetConfig exposed as live "Feel" sliders. A
// thin override layer on top of the active preset/profile; baked into a profile
// on save (snapshotCurrentPreset) and cleared whenever a preset/profile is
// chosen so the sliders reflect that look's values.
export type FeelParam =
  | "transitionMs"
  | "rippleAmount"
  | "rippleSpread"
  | "bloomMult"
  | "feedbackAmount"
  | "noiseMult"
  | "halation"
  | "grain";

export const PRESET_NAMES_RUNTIME = PRESET_NAMES;

export interface PresetSlice {
  // Effects-deck preset state. Controls which named look the shader is
  // cross-fading toward; driven manually, by a timer, by section triggers
  // (from job.status reason="section"), or by LLM suggestions.
  preset: PresetName;
  presetMode: PresetMode;
  presetCycleMs: number;
  // Monotonic counter — bumped whenever a new preset is SELECTED (from any
  // source). DisplacementCanvas subscribes to this to start a cross-fade.
  presetTick: number;
  // When set, takes precedence over `preset` as the crossfade target. Holds a
  // DB-loaded look profile's config (or a built-in's, after applyLookConfig).
  customPreset: PresetConfig | null;
  // Renderer writes here each tick so a save can capture it (looks.create).
  lastEffective: PresetConfig | null;
  // Live "Feel" overrides applied on top of the active preset (no crossfade).
  // Captured into a saved profile on save; cleared when a preset/profile is
  // chosen so the sliders reflect that look's values.
  paramOverrides: Partial<Record<FeelParam, number>>;
  // Ring buffer of recent final frame URLs, newest-first. Used by the ghost
  // callback overlay to resurface earlier scenes at low opacity.
  heroBank: string[];

  setPreset: (name: PresetName) => void;
  setPresetMode: (m: PresetMode) => void;
  setPresetCycleMs: (ms: number) => void;
  setLastEffective: (cfg: PresetConfig) => void;
  setParamOverride: (field: FeelParam, value: number) => void;
  // Apply a DB look profile's config as the active custom look (BASE-backfilled
  // so older/partial configs never NaN the renderer). Network (list/save/
  // delete) lives in use-look-profiles; the store just renders what it's given.
  applyLookConfig: (config: Record<string, number | number[]>) => void;
  pushHero: (url: string) => void;
}

export const createPresetSlice: StateCreator<
  VisualizerState,
  [],
  [],
  PresetSlice
> = (set) => ({
  applyLookConfig: (config) =>
    set((s) => ({
      // BASE backfills any field a profile predates so lerpPreset never sees
      // undefined (→ NaN) for newer feel params.
      customPreset: { ...BASE, ...(config as Partial<PresetConfig>) },
      paramOverrides: {},
      presetTick: s.presetTick + 1,
    })),
  customPreset: null,
  heroBank: [],
  lastEffective: null,
  paramOverrides: {},
  preset: "rave",
  presetCycleMs: 90_000,
  presetMode: "manual",
  presetTick: 0,
  // Ring buffer: keep last 6 unique URLs, newest-first. Dedupes on push so
  // a preview+final pair doesn't store two slots for one generation.
  pushHero: (url) =>
    set((s) => {
      if (!url || s.heroBank[0] === url) {
        return {};
      }
      const next = [url, ...s.heroBank.filter((u) => u !== url)].slice(0, 6);
      return { heroBank: next };
    }),
  setLastEffective: (cfg) => set({ lastEffective: cfg }),
  setParamOverride: (field, value) =>
    set((s) => ({ paramOverrides: { ...s.paramOverrides, [field]: value } })),
  setPreset: (name) =>
    set((s) => {
      // Selecting a built-in always clears any active custom (saved) preset
      // override so the chip UI stays consistent with what's rendering.
      if (s.preset === name && s.customPreset === null) {
        return {};
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PRESET_KEY, name);
      }
      return {
        customPreset: null,
        paramOverrides: {},
        preset: name,
        presetTick: s.presetTick + 1,
      };
    }),
  setPresetCycleMs: (ms) => set({ presetCycleMs: Math.max(5000, ms) }),
  setPresetMode: (m) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PRESET_MODE_KEY, m);
    }
    set({ presetMode: m });
  },
});
