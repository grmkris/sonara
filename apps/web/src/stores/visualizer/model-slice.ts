import { DEFAULT_RESOLUTION, RENDER_RESOLUTIONS } from "@sonara/shared";
import type { RenderResolution } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Studio A/B pick: which render resolution the live session uses. The CLIENT
// is authoritative here: the user's choice persists to localStorage and is
// re-sent to the server on every (re)connect (see use-ws-session), so a fresh
// Session adopts it. The setter is local-only — the WS send is done by the
// picker.

export const RESOLUTION_KEY = "viz_resolution";

export interface ModelSlice {
  resolution: RenderResolution;

  setResolution: (resolution: RenderResolution) => void;
}

export const createModelSlice: StateCreator<
  VisualizerState,
  [],
  [],
  ModelSlice
> = (set) => ({
  resolution: DEFAULT_RESOLUTION,
  setResolution: (resolution) => {
    set({ resolution });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(RESOLUTION_KEY, String(resolution));
    }
  },
});

// Post-mount hydration from localStorage (mirrors the preset prefs). Server
// always renders with the default; the client applies the stored preference
// after mount so SSR + first client render stay consistent.
//
// The resolution A/B is dev instrumentation (the picker renders only with
// ?lab=1), so the stored pick applies ONLY in lab mode — otherwise a pref
// persisted by a past experiment would silently override the product default
// forever, with no visible picker to undo it.
export const readModelPrefs = (): { resolution: RenderResolution } => {
  if (typeof window === "undefined") {
    return { resolution: DEFAULT_RESOLUTION };
  }
  const lab = new URLSearchParams(window.location.search).has("lab");
  if (!lab) {
    return { resolution: DEFAULT_RESOLUTION };
  }
  const r = window.localStorage.getItem(RESOLUTION_KEY);
  const parsed = r ? Number(r) : Number.NaN;
  const resolution = (RENDER_RESOLUTIONS as readonly number[]).includes(parsed)
    ? (parsed as RenderResolution)
    : DEFAULT_RESOLUTION;
  return { resolution };
};
