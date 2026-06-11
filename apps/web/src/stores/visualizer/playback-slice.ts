import { defaultAudio } from "@sonara/shared";
import type { AudioFeatures, NowPlaying } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

export interface PlaybackSlice {
  audio: AudioFeatures;
  nowPlaying: NowPlaying | null;
  // Monotonic counter — bumped whenever a manual "identify this" request is
  // made from the UI. `use-song-recognition` subscribes and kicks a new call.
  identifyTick: number;
  // True while a recognition call is in flight. Drives the now-playing
  // button's spinner so the user sees "listening…" instead of a silent UI.
  recognizing: boolean;

  setAudio: (f: AudioFeatures) => void;
  setNowPlaying: (track: NowPlaying | null) => void;
  requestIdentify: () => void;
  setRecognizing: (r: boolean) => void;
}

export const createPlaybackSlice: StateCreator<
  VisualizerState,
  [],
  [],
  PlaybackSlice
> = (set) => ({
  audio: { ...defaultAudio },
  identifyTick: 0,
  nowPlaying: null,
  recognizing: false,
  requestIdentify: () => set((s) => ({ identifyTick: s.identifyTick + 1 })),
  setAudio: (f) => set({ audio: f }),
  setNowPlaying: (track) => set({ nowPlaying: track }),
  setRecognizing: (r) => set({ recognizing: r }),
});
