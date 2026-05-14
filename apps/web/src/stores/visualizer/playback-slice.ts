import type { StateCreator } from "zustand";
import {
  type AudioFeatures,
  type NowPlaying,
  defaultAudio,
} from "@sonara/shared";
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
  nowPlaying: null,
  identifyTick: 0,
  recognizing: false,

  setAudio: (f) => set({ audio: f }),
  setNowPlaying: (track) => set({ nowPlaying: track }),
  requestIdentify: () => set((s) => ({ identifyTick: s.identifyTick + 1 })),
  setRecognizing: (r) => set({ recognizing: r }),
});
