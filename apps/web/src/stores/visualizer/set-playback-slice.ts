import type { LibraryFrame } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Cadence for stepping through a reel/session on replay. "fixed" holds each
// frame an equal beat; "original" reconstructs the live timing from tMs deltas
// (used when replaying a recorded session).
export type ReelPlaybackCadence = "fixed" | "original";

// Drives the client-side replay producer (use-reel-playback-loop). When active,
// the reel loop is the SOLE frame producer: the demo loop bails (see its
// reelPlaybackActive guard) and we don't fire any live generation. Activation
// snapshots `demoMode` into `prevDemoMode` and forces it off so the WS state()
// hydration can't restart the demo loop mid-replay; stopping restores it.
export interface ReelPlaybackSlice {
  reelPlaybackActive: boolean;
  // Reel id (rel_…) or live-session id (lse_…) being replayed — display/debug only.
  reelPlaybackId: string | null;
  reelPlaybackName: string | null;
  reelPlaybackFrames: LibraryFrame[];
  reelPlaybackCadence: ReelPlaybackCadence;
  // demoMode value captured at playback start, restored on exit. Null when not
  // playing. We set demoMode directly (not via setDemoMode) so the user's
  // persisted demo preference in localStorage is never clobbered.
  prevDemoMode: boolean | null;

  startReelPlayback: (args: {
    id: string | null;
    name: string | null;
    frames: LibraryFrame[];
    cadence: ReelPlaybackCadence;
  }) => void;
  stopReelPlayback: () => void;
}

export const createReelPlaybackSlice: StateCreator<
  VisualizerState,
  [],
  [],
  ReelPlaybackSlice
> = (set) => ({
  prevDemoMode: null,
  reelPlaybackActive: false,
  reelPlaybackCadence: "fixed",
  reelPlaybackFrames: [],
  reelPlaybackId: null,
  reelPlaybackName: null,
  startReelPlayback: ({ id, name, frames, cadence }) =>
    set((s) => ({
      demoMode: false,
      // Snapshot only on the first start so a re-target mid-playback keeps the
      // original demo value to restore.
      prevDemoMode: s.reelPlaybackActive ? s.prevDemoMode : s.demoMode,
      reelPlaybackActive: true,
      reelPlaybackCadence: cadence,
      reelPlaybackFrames: frames,
      reelPlaybackId: id,
      reelPlaybackName: name,
    })),
  stopReelPlayback: () =>
    set((s) => ({
      demoMode: s.prevDemoMode ?? false,
      prevDemoMode: null,
      reelPlaybackActive: false,
      reelPlaybackFrames: [],
      reelPlaybackId: null,
      reelPlaybackName: null,
    })),
});
