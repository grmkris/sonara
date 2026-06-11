import type { LibraryFrame } from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// Cadence for stepping through a set on replay. "fixed" holds each frame an
// equal beat; "original" reconstructs the live timing from tMs deltas (used
// when replaying a recording).
export type SetPlaybackCadence = "fixed" | "original";

// Drives the client-side replay producer (use-set-playback-loop). When active,
// the set loop is the SOLE frame producer: the demo loop bails (see its
// setPlaybackActive guard) and we don't fire any live generation. Activation
// snapshots `demoMode` into `prevDemoMode` and forces it off so the WS state()
// hydration can't restart the demo loop mid-replay; stopping restores it.
export interface SetPlaybackSlice {
  setPlaybackActive: boolean;
  // Set id (set_…) or live-session id (lse_…) being replayed — display/debug only.
  setPlaybackId: string | null;
  setPlaybackName: string | null;
  setPlaybackFrames: LibraryFrame[];
  setPlaybackCadence: SetPlaybackCadence;
  // demoMode value captured at playback start, restored on exit. Null when not
  // playing. We set demoMode directly (not via setDemoMode) so the user's
  // persisted demo preference in localStorage is never clobbered.
  prevDemoMode: boolean | null;

  startSetPlayback: (args: {
    id: string | null;
    name: string | null;
    frames: LibraryFrame[];
    cadence: SetPlaybackCadence;
  }) => void;
  stopSetPlayback: () => void;
}

export const createSetPlaybackSlice: StateCreator<
  VisualizerState,
  [],
  [],
  SetPlaybackSlice
> = (set) => ({
  prevDemoMode: null,
  setPlaybackActive: false,
  setPlaybackCadence: "fixed",
  setPlaybackFrames: [],
  setPlaybackId: null,
  setPlaybackName: null,
  startSetPlayback: ({ id, name, frames, cadence }) =>
    set((s) => ({
      demoMode: false,
      // Snapshot only on the first start so a re-target mid-playback keeps the
      // original demo value to restore.
      prevDemoMode: s.setPlaybackActive ? s.prevDemoMode : s.demoMode,
      setPlaybackActive: true,
      setPlaybackCadence: cadence,
      setPlaybackFrames: frames,
      setPlaybackId: id,
      setPlaybackName: name,
    })),
  stopSetPlayback: () =>
    set((s) => ({
      demoMode: s.prevDemoMode ?? false,
      prevDemoMode: null,
      setPlaybackActive: false,
      setPlaybackFrames: [],
      setPlaybackId: null,
      setPlaybackName: null,
    })),
});
