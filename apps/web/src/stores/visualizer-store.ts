import { create } from "zustand";
import {
  type AudioFeatures,
  type DreamSceneState,
  defaultAudio,
  defaultScene,
} from "@music-visualizer/shared";
import {
  PRESET_NAMES,
  type PresetConfig,
  type PresetName,
} from "@/lib/render/presets";

export type PresetMode = "manual" | "cycle" | "section" | "llm";
const PRESET_KEY = "dream.preset";
const PRESET_MODE_KEY = "dream.presetMode";
const SAVED_PRESETS_KEY = "dream.savedPresets";

export type JobStatus = "idle" | "running" | "cancelled" | "error";
export type TriggerReason =
  | "pause"
  | "semantic"
  | "section"
  | "periodic"
  | "commit"
  | "voice";

export interface TriggerEntry {
  id: number;
  reason: TriggerReason;
  version: number;
  at: number;
}

const TRIGGER_LOG_MAX = 16;
const UI_VISIBLE_KEY = "dream.uiVisible";

// Always `true` on first render (server + client) so SSR hydrates cleanly. The
// stored preference is applied post-mount via `hydrateUiVisible()`.
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
  if (p && (PRESET_NAMES as readonly string[]).includes(p)) {
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

export interface VisualizerState {
  scene: DreamSceneState;
  audio: AudioFeatures;
  previousFrame: string | null;
  currentFrame: string | null;
  crossfadeStartedAt: number | null;
  status: JobStatus;
  statusMessage: string | null;
  connected: boolean;

  uiVisible: boolean;
  commitPulse: number;
  sweepPulse: number;
  latestVersion: number;
  triggerLog: TriggerEntry[];

  // Effects-deck preset state. Controls which named look the shader is
  // cross-fading toward; driven manually, by a timer, by section triggers
  // (from job.status reason="section"), or by LLM suggestions.
  preset: PresetName;
  presetMode: PresetMode;
  presetCycleMs: number;
  // Monotonic counter — bumped whenever a new preset is SELECTED (from any
  // source). DisplacementCanvas subscribes to this to start a cross-fade.
  presetTick: number;
  // Ad-hoc saved presets captured from mid-crossfade effective state.
  // Keys are user-supplied names; values are full PresetConfig snapshots.
  savedPresets: Record<string, PresetConfig>;
  // When set, takes precedence over `preset` as the crossfade target. Used
  // for saved snapshots since their configs don't live in the PRESETS map.
  customPreset: PresetConfig | null;
  // Renderer writes here each tick so snapshotCurrentPreset can capture it.
  lastEffective: PresetConfig | null;
  // Ring buffer of recent final frame URLs, newest-first. Used by the ghost
  // callback overlay to resurface earlier scenes at low opacity.
  heroBank: string[];

  setScene: (state: DreamSceneState) => void;
  setAudio: (f: AudioFeatures) => void;
  pushFrame: (url: string, version: number) => void;
  setStatus: (s: JobStatus, msg?: string) => void;
  setConnected: (c: boolean) => void;

  toggleUi: () => void;
  setUiVisible: (v: boolean) => void;
  pulseCommit: () => void;
  pushTrigger: (reason: TriggerReason, version: number) => void;

  setPreset: (name: PresetName) => void;
  setPresetMode: (m: PresetMode) => void;
  setPresetCycleMs: (ms: number) => void;
  setLastEffective: (cfg: PresetConfig) => void;
  snapshotCurrentPreset: (name: string) => void;
  selectSavedPreset: (name: string) => void;
  deleteSavedPreset: (name: string) => void;
  pushHero: (url: string) => void;
}

export const useVisualizerStore = create<VisualizerState>()((set, get) => ({
  scene: { ...defaultScene },
  audio: { ...defaultAudio },
  previousFrame: null,
  currentFrame: null,
  crossfadeStartedAt: null,
  status: "idle",
  statusMessage: null,
  connected: false,

  uiVisible: true,
  commitPulse: 0,
  sweepPulse: 0,
  latestVersion: 0,
  triggerLog: [],

  preset: "wet_ink",
  presetMode: "manual",
  presetCycleMs: 90_000,
  presetTick: 0,
  savedPresets: {},
  customPreset: null,
  lastEffective: null,
  heroBank: [],

  setScene: (state) => set({ scene: state }),
  setAudio: (f) => set({ audio: f }),
  pushFrame: (url, version) => {
    if (version < get().latestVersion) return;
    // Deliberately do NOT reset crossfadeStartedAt here. If we null it, the
    // renderer branches to bleedT=1 until the new image actually decodes —
    // which guillotines any in-progress bleed the instant a new URL arrives.
    // markImageLoaded() is the sole writer, fired when the texture is actually
    // ready. Until then, the old bleed continues gracefully.
    set((s) => ({
      previousFrame: s.currentFrame,
      currentFrame: url,
      latestVersion: version,
    }));
  },
  setStatus: (status, message) => {
    set({ status, statusMessage: message ?? null });
    if (status === "running") set((s) => ({ sweepPulse: s.sweepPulse + 1 }));
  },
  setConnected: (c) => set({ connected: c }),

  toggleUi: () =>
    set((s) => {
      const next = !s.uiVisible;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(UI_VISIBLE_KEY, next ? "1" : "0");
      }
      return { uiVisible: next };
    }),
  setUiVisible: (v) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(UI_VISIBLE_KEY, v ? "1" : "0");
    }
    set({ uiVisible: v });
  },
  pulseCommit: () => set((s) => ({ commitPulse: s.commitPulse + 1 })),
  pushTrigger: (reason, version) =>
    set((s) => {
      const entry: TriggerEntry = {
        id: (s.triggerLog[0]?.id ?? 0) + 1,
        reason,
        version,
        at: Date.now(),
      };
      return { triggerLog: [entry, ...s.triggerLog].slice(0, TRIGGER_LOG_MAX) };
    }),

  setPreset: (name) =>
    set((s) => {
      // Selecting a built-in always clears any active custom (saved) preset
      // override so the chip UI stays consistent with what's rendering.
      if (s.preset === name && s.customPreset === null) return {};
      if (typeof window !== "undefined") {
        window.localStorage.setItem(PRESET_KEY, name);
      }
      return {
        preset: name,
        customPreset: null,
        presetTick: s.presetTick + 1,
      };
    }),
  setPresetMode: (m) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PRESET_MODE_KEY, m);
    }
    set({ presetMode: m });
  },
  setPresetCycleMs: (ms) => set({ presetCycleMs: Math.max(5_000, ms) }),
  setLastEffective: (cfg) => set({ lastEffective: cfg }),
  snapshotCurrentPreset: (name) =>
    set((s) => {
      if (!s.lastEffective) return {};
      const trimmed = name.trim();
      if (!trimmed) return {};
      const next = { ...s.savedPresets, [trimmed]: { ...s.lastEffective } };
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
      }
      return {
        savedPresets: next,
        customPreset: { ...s.lastEffective },
        presetTick: s.presetTick + 1,
      };
    }),
  selectSavedPreset: (name) =>
    set((s) => {
      const cfg = s.savedPresets[name];
      if (!cfg) return {};
      return {
        customPreset: { ...cfg },
        presetTick: s.presetTick + 1,
      };
    }),
  deleteSavedPreset: (name) =>
    set((s) => {
      if (!(name in s.savedPresets)) return {};
      const next = { ...s.savedPresets };
      delete next[name];
      if (typeof window !== "undefined") {
        window.localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(next));
      }
      return { savedPresets: next };
    }),
  // Ring buffer: keep last 6 unique URLs, newest-first. Dedupes on push so
  // a preview+final pair doesn't store two slots for one generation.
  pushHero: (url) =>
    set((s) => {
      if (!url || s.heroBank[0] === url) return {};
      const next = [url, ...s.heroBank.filter((u) => u !== url)].slice(0, 6);
      return { heroBank: next };
    }),
}));

/**
 * Crossfade timing is driven by the `<img>.onLoad` event rather than the moment
 * a URL arrives. This avoids the black flash when a large fal image hasn't
 * decoded by the time the crossfade window (800 ms) elapses.
 */
export function markImageLoaded(): void {
  useVisualizerStore.setState({ crossfadeStartedAt: performance.now() });
}
