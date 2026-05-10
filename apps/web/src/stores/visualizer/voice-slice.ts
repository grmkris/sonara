import type { StateCreator } from "zustand";
import type { VisualizerState } from "./types";

export const VOICE_MODE_KEY = "dream.voiceMode";

// Single in-flight voice utterance for the trail UI. The three stages each
// land independently (voice.partial → voice.parsed → voice.applied) so we
// keep them as nullable fields and a stage cursor advances as they arrive.
// On a fresh phraseId we discard the prior trail.
export type VoiceTrailStage = "idle" | "heard" | "understood" | "applied";

export interface VoiceTrailIntent {
  patch: Record<string, unknown>;
  commit: boolean;
  reset: boolean;
  preset: string | null;
  lookPreset: string | null;
  atmosphere: string | null;
}

export interface VoiceTrailState {
  phraseId: number;
  text: string;
  isFinal: boolean;
  confidence: number | null;
  provider: "web-speech";
  intent: VoiceTrailIntent | null;
  parsedLatencyMs: number | null;
  appliedPatch: Record<string, unknown> | null;
  triggered: boolean | null;
  triggeredVersion: number | null;
  startedAt: number;
  updatedAt: number;
}

export interface VoiceSlice {
  voiceTrail: VoiceTrailState | null;
  // Voice input mode (purely client-side).
  //   "live" — recognition runs continuously while toggled on.
  //   "ptt"  — hold SPACE to start recognition; release stops it.
  // Default is "ptt" — safer in multi-person rooms. Persisted in localStorage.
  voiceMode: "live" | "ptt";
  // Ephemeral — true while the PTT key is currently held. Drives the armed
  // indicator in the voice-listen UI.
  voicePtt: boolean;

  voicePartial: (opts: {
    phraseId: number;
    text: string;
    isFinal: boolean;
    confidence?: number;
    provider: "web-speech";
  }) => void;
  voiceParsed: (opts: {
    phraseId: number;
    intent: VoiceTrailIntent;
    latencyMs: number;
  }) => void;
  voiceApplied: (opts: {
    phraseId: number;
    patch: Record<string, unknown>;
    triggered: boolean;
    triggeredVersion?: number;
  }) => void;
  clearVoiceTrail: () => void;
  setVoiceMode: (m: "live" | "ptt") => void;
  setVoicePtt: (v: boolean) => void;
}

export const createVoiceSlice: StateCreator<
  VisualizerState,
  [],
  [],
  VoiceSlice
> = (set) => ({
  voiceTrail: null,
  voiceMode: "ptt",
  voicePtt: false,

  voicePartial: (opts) =>
    set((s) => {
      const isNewPhrase =
        !s.voiceTrail || s.voiceTrail.phraseId !== opts.phraseId;
      const now = Date.now();
      return {
        voiceTrail: {
          phraseId: opts.phraseId,
          text: opts.text,
          isFinal: opts.isFinal,
          confidence:
            typeof opts.confidence === "number" ? opts.confidence : null,
          provider: opts.provider,
          intent: isNewPhrase ? null : (s.voiceTrail?.intent ?? null),
          parsedLatencyMs: isNewPhrase
            ? null
            : (s.voiceTrail?.parsedLatencyMs ?? null),
          appliedPatch: isNewPhrase
            ? null
            : (s.voiceTrail?.appliedPatch ?? null),
          triggered: isNewPhrase ? null : (s.voiceTrail?.triggered ?? null),
          triggeredVersion: isNewPhrase
            ? null
            : (s.voiceTrail?.triggeredVersion ?? null),
          startedAt: isNewPhrase ? now : (s.voiceTrail?.startedAt ?? now),
          updatedAt: now,
        },
      };
    }),
  voiceParsed: (opts) =>
    set((s) => {
      // Late-arriving parse for an already-replaced phrase: ignore.
      if (!s.voiceTrail || s.voiceTrail.phraseId !== opts.phraseId) return {};
      return {
        voiceTrail: {
          ...s.voiceTrail,
          intent: opts.intent,
          parsedLatencyMs: opts.latencyMs,
          updatedAt: Date.now(),
        },
      };
    }),
  voiceApplied: (opts) =>
    set((s) => {
      if (!s.voiceTrail || s.voiceTrail.phraseId !== opts.phraseId) return {};
      return {
        voiceTrail: {
          ...s.voiceTrail,
          appliedPatch: opts.patch,
          triggered: opts.triggered,
          triggeredVersion: opts.triggeredVersion ?? null,
          updatedAt: Date.now(),
        },
      };
    }),
  clearVoiceTrail: () => set({ voiceTrail: null }),
  setVoiceMode: (m) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VOICE_MODE_KEY, m);
    }
    set({ voiceMode: m });
  },
  setVoicePtt: (v) => set({ voicePtt: v }),
});
