import { create } from "zustand";

import type { PresetName } from "@/lib/render/presets";

import {
  createImageAnchorSlice,
  readClickwrapAccepted,
} from "./image-anchor-slice";
import { createInspectorSlice } from "./inspector-slice";
import { createLibrarySlice } from "./library-slice";
import { createModelSlice, readModelPrefs } from "./model-slice";
import { createPlaybackSlice } from "./playback-slice";
import {
  PRESET_KEY,
  PRESET_MODE_KEY,
  PRESET_NAMES_RUNTIME,
  createPresetSlice,
} from "./preset-slice";
import { createSceneSlice } from "./scene-slice";
import { createSourceSlice, readSourcePref } from "./source-slice";
import { createStageSlice } from "./stage-slice";
import type { VisualizerState } from "./types";
import { UI_VISIBLE_KEY, createUiSlice } from "./ui-slice";
import { createVoiceSlice } from "./voice-slice";

export const useVisualizerStore = create<VisualizerState>()((...a) => ({
  ...createSceneSlice(...a),
  ...createPlaybackSlice(...a),
  ...createUiSlice(...a),
  ...createInspectorSlice(...a),
  ...createVoiceSlice(...a),
  ...createPresetSlice(...a),
  ...createSourceSlice(...a),
  ...createImageAnchorSlice(...a),
  ...createLibrarySlice(...a),
  ...createModelSlice(...a),
  ...createStageSlice(...a),
}));

// ---------------------------------------------------------------------
// Hydration helpers — apply localStorage preferences post-mount so SSR +
// first client render stay in sync. Called from a top-level `useEffect`.
// ---------------------------------------------------------------------

// Always `true` on first render (server + client) so SSR hydrates cleanly.
// The stored preference is applied post-mount via `hydrateUiVisible()`.
export const hydrateUiVisible = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const raw = window.localStorage.getItem(UI_VISIBLE_KEY);
  if (raw === null) {
    return;
  }
  useVisualizerStore.setState({ uiVisible: raw !== "0" });
};

// Pulls the last-used preset + mode from localStorage. Matches the
// hydrateUiVisible pattern — server always renders with `wet_ink` / `manual`,
// client applies the stored preference post-mount.
export const hydratePresetPrefs = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const p = window.localStorage.getItem(PRESET_KEY);
  const m = window.localStorage.getItem(PRESET_MODE_KEY);
  const update: Partial<VisualizerState> = {};
  if (p && (PRESET_NAMES_RUNTIME as readonly string[]).includes(p)) {
    update.preset = p as PresetName;
  }
  if (m === "manual" || m === "cycle" || m === "section" || m === "llm") {
    update.presetMode = m;
  }
  if (Object.keys(update).length > 0) {
    useVisualizerStore.setState(update);
  }
};

// Same hydration pattern as preset prefs — apply the persisted playback
// source (deck/idle only) post-mount so SSR + first client render stay
// consistent.
export const hydrateSourcePref = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const source = readSourcePref();
  if (source) {
    useVisualizerStore.setState({ source });
  }
};

// Same hydration pattern — apply the stored A/B model + resolution picks
// post-mount so SSR + first client render stay consistent.
export const hydrateModelPrefs = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  const { resolution } = readModelPrefs();
  useVisualizerStore.setState({ resolution });
};

// Hydrates the clickwrap-acceptance flag from localStorage so the user
// doesn't see the consent prompt twice in the same browser.
export const hydrateAnchorPrefs = (): void => {
  if (typeof window === "undefined") {
    return;
  }
  if (readClickwrapAccepted()) {
    useVisualizerStore.setState({ clickwrapAccepted: true });
  }
};

/**
 * Crossfade timing is driven by the `<img>.onLoad` event rather than the
 * moment a URL arrives. This avoids the black flash when a large fal image
 * hasn't decoded by the time the crossfade window (800 ms) elapses.
 */
export const markImageLoaded = (): void => {
  useVisualizerStore.setState({ crossfadeStartedAt: performance.now() });
};

// Re-export slice types from one entry so consumers can import everything
// they need from `@/stores/visualizer`.
export type {
  InspectorState,
  TriggerEntry,
  TriggerReason,
  DriftSource,
} from "./inspector-slice";
export type { JobStatus } from "./scene-slice";
export type { PresetMode } from "./preset-slice";
export type { VisualizerState } from "./types";
