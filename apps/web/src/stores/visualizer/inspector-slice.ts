import type { StateCreator } from "zustand";
import type { ResolvedScene } from "@sonara/shared";
import type { VisualizerState } from "./types";

export type TriggerReason =
  | "pause"
  | "semantic"
  | "section"
  | "periodic"
  | "commit"
  | "voice";

export type DriftSource = "pool" | "none";

export interface TriggerEntry {
  id: number;
  reason: TriggerReason;
  version: number;
  at: number;
  durationMs?: number;
  success?: boolean;
}

// Snapshot of the most recent server-side trigger for the inspector HUD.
// Populated from `generation.requested`; durationMs/success arrive via
// `generation.completed`.
export interface InspectorState {
  reason: TriggerReason;
  version: number;
  promptString: string;
  driftSource: DriftSource;
  resolvedScene: ResolvedScene;
  requestedAt: number;
  nextKeyframeAt: number;
  completedAt: number | null;
  durationMs: number | null;
  success: boolean | null;
}

const TRIGGER_LOG_MAX = 16;

export interface InspectorSlice {
  triggerLog: TriggerEntry[];
  inspector: InspectorState | null;

  pushTrigger: (reason: TriggerReason, version: number) => void;
  setInspectorRequested: (
    entry: Omit<InspectorState, "completedAt" | "durationMs" | "success">,
  ) => void;
  setInspectorCompleted: (
    version: number,
    durationMs: number,
    success: boolean,
  ) => void;
}

export const createInspectorSlice: StateCreator<
  VisualizerState,
  [],
  [],
  InspectorSlice
> = (set) => ({
  triggerLog: [],
  inspector: null,

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
  setInspectorRequested: (entry) =>
    set({
      inspector: {
        ...entry,
        completedAt: null,
        durationMs: null,
        success: null,
      },
    }),
  setInspectorCompleted: (version, durationMs, success) =>
    set((s) => {
      const triggerLog = s.triggerLog.map((e) =>
        e.version === version ? { ...e, durationMs, success } : e,
      );
      // Stale completion arrives after a newer requested — keep the log
      // patch but don't overwrite the live inspector header.
      if (!s.inspector || s.inspector.version !== version) {
        return { triggerLog };
      }
      return {
        triggerLog,
        inspector: {
          ...s.inspector,
          completedAt: Date.now(),
          durationMs,
          success,
        },
      };
    }),
});
