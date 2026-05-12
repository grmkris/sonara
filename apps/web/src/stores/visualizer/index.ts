import { create } from "zustand";
import { createInspectorSlice } from "./inspector-slice";
import { createPlaybackSlice } from "./playback-slice";
import {
  PRESET_KEY,
  PRESET_MODE_KEY,
  PRESET_NAMES_RUNTIME,
  SAVED_PRESETS_KEY,
  createPresetSlice,
} from "./preset-slice";
import { createSceneSlice } from "./scene-slice";
import { UI_VISIBLE_KEY, createUiSlice } from "./ui-slice";
import { createVoiceSlice } from "./voice-slice";
import type { VisualizerState } from "./types";
import type { PresetConfig, PresetName } from "@/lib/render/presets";

export const useVisualizerStore = create<VisualizerState>()((...a) => ({
  ...createSceneSlice(...a),
  ...createPlaybackSlice(...a),
  ...createUiSlice(...a),
  ...createInspectorSlice(...a),
  ...createVoiceSlice(...a),
  ...createPresetSlice(...a),
}));

// ---------------------------------------------------------------------
// Hydration helpers — apply localStorage preferences post-mount so SSR +
// first client render stay in sync. Called from a top-level `useEffect`.
// ---------------------------------------------------------------------

// Always `true` on first render (server + client) so SSR hydrates cleanly.
// The stored preference is applied post-mount via `hydrateUiVisible()`.
export function hydrateUiVisible(): void {
  if (typeof window === "undefined") return;
  const raw = window.localStorage.getItem(UI_VISIBLE_KEY);
  if (raw === null) return;
  useVisualizerStore.setState({ uiVisible: raw !== "0" });
}

// Pulls the last-used preset + mode from localStorage. Matches the
// hydrateUiVisible pattern — server always renders with `wet_ink` / `manual`,
// client applies the stored preference post-mount.
export function hydratePresetPrefs(): void {
  if (typeof window === "undefined") return;
  const p = window.localStorage.getItem(PRESET_KEY);
  const m = window.localStorage.getItem(PRESET_MODE_KEY);
  const saved = window.localStorage.getItem(SAVED_PRESETS_KEY);
  const update: Partial<VisualizerState> = {};
  if (p && (PRESET_NAMES_RUNTIME as readonly string[]).includes(p)) {
    update.preset = p as PresetName;
  }
  if (m === "manual" || m === "cycle" || m === "section" || m === "llm") {
    update.presetMode = m;
  }
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === "object") {
        update.savedPresets = parsed as Record<string, PresetConfig>;
      }
    } catch {
      // ignore corrupt value
    }
  }
  if (Object.keys(update).length > 0) useVisualizerStore.setState(update);
}

/**
 * Crossfade timing is driven by the `<img>.onLoad` event rather than the
 * moment a URL arrives. This avoids the black flash when a large fal image
 * hasn't decoded by the time the crossfade window (800 ms) elapses.
 */
export function markImageLoaded(): void {
  useVisualizerStore.setState({ crossfadeStartedAt: performance.now() });
}

// Re-export slice types so consumers importing from `@/stores/visualizer-store`
// (via the back-compat barrel) keep getting the same surface.
export type {
  InspectorState,
  TriggerEntry,
  TriggerReason,
  DriftSource,
} from "./inspector-slice";
export type { JobStatus } from "./scene-slice";
export type { PresetMode } from "./preset-slice";
export type { VoiceField } from "./voice-slice";
export type { VisualizerState } from "./types";
