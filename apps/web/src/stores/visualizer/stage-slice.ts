import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Monad crowd-stage state for THIS projector tab. Fed by the `stage.status`
// ServerEvent (use-ws-session): non-null while the owner has the stage open.
// The /play wire overlay mounts on it and dials the public /ws/stage feed.
// Ephemeral by design — a stage is a live-performance surface, not a pref.

export interface StageSlice {
  stageRoom: string | null;
  // Host-toggled (from /control) join-QR overlay on the projector.
  stageShowQr: boolean;
  setStageRoom: (room: string | null) => void;
  setStageShowQr: (show: boolean) => void;
}

export const createStageSlice: StateCreator<
  VisualizerState,
  [],
  [],
  StageSlice
> = (set) => ({
  setStageRoom: (room) => set({ stageRoom: room }),
  setStageShowQr: (show) => set({ stageShowQr: show }),
  stageRoom: null,
  stageShowQr: true,
});
