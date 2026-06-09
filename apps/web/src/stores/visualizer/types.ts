import type { DemoSlice } from "./demo-slice";
import type { ImageAnchorSlice } from "./image-anchor-slice";
import type { InspectorSlice } from "./inspector-slice";
import type { LibrarySlice } from "./library-slice";
import type { ModelSlice } from "./model-slice";
import type { PlaybackSlice } from "./playback-slice";
import type { PresetSlice } from "./preset-slice";
import type { ReelPlaybackSlice } from "./reel-playback-slice";
import type { SceneSlice } from "./scene-slice";
import type { UiSlice } from "./ui-slice";
import type { VoiceSlice } from "./voice-slice";

// The full root state — union of every slice. Each slice's StateCreator is
// parameterised by this so cross-slice reads (e.g., `setStatus` bumping
// `sweepPulse`) typecheck against the merged shape.
export type VisualizerState = SceneSlice &
  PlaybackSlice &
  UiSlice &
  InspectorSlice &
  VoiceSlice &
  PresetSlice &
  DemoSlice &
  ImageAnchorSlice &
  LibrarySlice &
  ModelSlice &
  ReelPlaybackSlice;
