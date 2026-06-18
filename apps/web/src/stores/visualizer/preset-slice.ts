import type { StateCreator } from "zustand";

import { BASE, PRESET_NAMES } from "@/lib/render/presets";
import type { PresetConfig, PresetName } from "@/lib/render/presets";

import type { VisualizerState } from "./types";

export const PRESET_KEY = "sonara.preset";
export const PRESET_MODE_KEY = "sonara.presetMode";
export const SAVED_PRESETS_KEY = "sonara.savedPresets";

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
  // Ad-hoc saved presets captured from mid-crossfade effective state.
  // Keys are user-supplied names; values are full PresetConfig snapshots.
  savedPresets: Record<string, PresetConfig>;
  // When set, takes precedence over `preset` as the crossfade target. Used
  // for saved snapshots since their configs don't live in the PRESETS map.
  customPreset: PresetConfig | null;
  // Renderer writes here each tick so snapshotCurrentPreset can capture it.
  lastEffective: PresetConfig | null;
  // Live "Feel" overrides applied on top of the active preset (no crossfade).
  // Baked into a profile on save; cleared when a preset/profile is selected.
  paramOverrides: Partial<Record<FeelParam, number>>;
  // Ring buffer of recent final frame URLs, newest-first. Used by the ghost
  // callback overlay to resurface earlier scenes at low opacity.
  heroBank: string[];

  setPreset: (name: PresetName) => void;
  setPresetMode: (m: PresetMode) => void;
  setPresetCycleMs: (ms: number) => void;
  setLastEffective: (cfg: PresetConfig) => void;
  setParamOverride: (field: FeelParam, value: number) => void;
  snapshotCurrentPreset: (name: string) => void;
  selectSavedPreset: (name: string) => void;
  deleteSavedPreset: (name: string) => void;
  pushHero: (url: string) => void;
}

export const createPresetSlice: StateCreator<
  VisualizerState,
  [],
  [],
  PresetSlice
> = (set) => ({
  customPreset: null,
  deleteSavedPreset: (name) =>
    set((s) => {
      if (!(name in s.savedPresets)) {
        return {};
      }
      const next = { ...s.savedPresets };
      // oxlint-disable-next-line no-dynamic-delete -- REVIEW: savedPresets is a JSON-serialized record keyed by arbitrary user preset names; a Map would break persistence shape
      delete next[name];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
      }
      return { savedPresets: next };
    }),
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
  savedPresets: {},
  selectSavedPreset: (name) =>
    set((s) => {
      const cfg = s.savedPresets[name];
      if (!cfg) {
        return {};
      }
      return {
        // BASE backfills any field a profile saved before that field existed,
        // so lerpPreset never sees undefined (→ NaN) for the newer feel params.
        customPreset: { ...BASE, ...cfg },
        paramOverrides: {},
        presetTick: s.presetTick + 1,
      };
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
  snapshotCurrentPreset: (name) =>
    set((s) => {
      if (!s.lastEffective) {
        return {};
      }
      const trimmed = name.trim();
      if (!trimmed) {
        return {};
      }
      const next = { ...s.savedPresets, [trimmed]: { ...s.lastEffective } };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
      }
      return {
        customPreset: { ...s.lastEffective },
        paramOverrides: {},
        presetTick: s.presetTick + 1,
        savedPresets: next,
      };
    }),
});
