import type { VoiceField } from "@/stores/visualizer/voice-slice";

// Single source of truth for push-to-talk key bindings, consumed by
// VoiceListen (the PTT hook) and PromptInput (inline kbd hints next
// to each field label).
export const PTT_KEYMAP = {
  KeyS: "subject",
  KeyE: "environment",
  KeyM: "mood",
  KeyP: "palette",
} as const satisfies Record<string, VoiceField>;

export const PTT_LABEL: Record<VoiceField, string> = {
  subject: "S",
  environment: "E",
  mood: "M",
  palette: "P",
};

export const RESET_KEY = "R";
