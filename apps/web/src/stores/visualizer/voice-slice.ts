import type { StateCreator } from "zustand";
import type { VisualizerState } from "./types";

export type VoiceField = "subject" | "environment" | "mood" | "palette";

// Minimal keyed-PTT state. The user holds one of S/E/M/P to speak a value
// for that field. Mic is on only while a key is held; on release we dispatch
// the captured transcript as a direct field patch. No LLM disambiguation.
export interface VoiceSlice {
  /** Which field the user is currently speaking to. null when no key held. */
  activeField: VoiceField | null;
  /** Live transcript shown in the held chip. Cleared on key release. */
  liveTranscript: string;

  setActiveField: (f: VoiceField | null) => void;
  setLiveTranscript: (t: string) => void;
}

export const createVoiceSlice: StateCreator<
  VisualizerState,
  [],
  [],
  VoiceSlice
> = (set) => ({
  activeField: null,
  liveTranscript: "",
  setActiveField: (f) => set({ activeField: f }),
  setLiveTranscript: (t) => set({ liveTranscript: t }),
});
