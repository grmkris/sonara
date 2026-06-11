import {
  DEFAULT_RESOLUTION,
  DEFAULT_TEXT_MODEL,
  RENDER_RESOLUTIONS,
  TEXT_MODEL_KEYS,
} from "@sonara/shared";
import type { RenderResolution, TextModelKey } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Studio A/B picks: which fal text model + render resolution the live session
// uses. The CLIENT is authoritative here (unlike demo state, which is
// server-pinned): the user's choice persists to localStorage and is re-sent to
// the server on every (re)connect (see use-ws-session), so a fresh Session
// adopts it. These setters are local-only — the WS send is done by the picker.

export const MODEL_KEY = "viz_text_model";
export const RESOLUTION_KEY = "viz_resolution";

export interface ModelSlice {
  model: TextModelKey;
  resolution: RenderResolution;

  setModel: (model: TextModelKey) => void;
  setResolution: (resolution: RenderResolution) => void;
}

export const createModelSlice: StateCreator<
  VisualizerState,
  [],
  [],
  ModelSlice
> = (set) => ({
  model: DEFAULT_TEXT_MODEL,
  resolution: DEFAULT_RESOLUTION,
  setModel: (model) => {
    set({ model });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(MODEL_KEY, model);
    }
  },
  setResolution: (resolution) => {
    set({ resolution });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RESOLUTION_KEY, String(resolution));
    }
  },
});

// Post-mount hydration from localStorage (mirrors readDemoPrefs / preset
// prefs). Server always renders with the defaults; the client applies the
// stored preference after mount so SSR + first client render stay consistent.
export const readModelPrefs = (): {
  model: TextModelKey;
  resolution: RenderResolution;
} => {
  if (typeof window === "undefined") {
    return { model: DEFAULT_TEXT_MODEL, resolution: DEFAULT_RESOLUTION };
  }
  const m = window.localStorage.getItem(MODEL_KEY);
  const r = window.localStorage.getItem(RESOLUTION_KEY);
  const model =
    m && (TEXT_MODEL_KEYS as readonly string[]).includes(m)
      ? (m as TextModelKey)
      : DEFAULT_TEXT_MODEL;
  const parsed = r ? Number(r) : Number.NaN;
  const resolution = (RENDER_RESOLUTIONS as readonly number[]).includes(parsed)
    ? (parsed as RenderResolution)
    : DEFAULT_RESOLUTION;
  return { model, resolution };
};
