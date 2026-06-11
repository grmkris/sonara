import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Tap-to-dictate state. The mic button on PromptInput toggles between
// listening / not-listening; the transcript streams into the textarea as
// draft text while listening. Commit happens when the user reviews and
// presses Enter, NOT on stop — that way the user can edit the dictation
// before sending.
export interface VoiceSlice {
  /** True while the SpeechRecognition session is active. */
  isListening: boolean;
  /** Latest interim+final transcript while listening; cleared on start. */
  liveTranscript: string;

  setIsListening: (b: boolean) => void;
  setLiveTranscript: (t: string) => void;
}

export const createVoiceSlice: StateCreator<
  VisualizerState,
  [],
  [],
  VoiceSlice
> = (set) => ({
  isListening: false,
  liveTranscript: "",
  setIsListening: (b) => set({ isListening: b }),
  setLiveTranscript: (t) => set({ liveTranscript: t }),
});
