import type { AudioFeatures, RenderState } from "@music-visualizer/shared";

// Targets for the render state given current audio features.
// Damping is applied separately in the render loop.
export function targetsFromAudio(audio: AudioFeatures): Partial<RenderState> {
  return {
    zoom: 1 + audio.bass * 0.06,
    bloom: 0.15 + audio.rms * 0.9,
    warp: audio.bass * 0.6 + audio.mids * 0.25,
    blur: Math.max(0, 0.25 - audio.treble * 0.18),
    paletteShift: audio.centroid * 0.15,
    motionEnergy: audio.rms * 0.7 + audio.bass * 0.3,
  };
}
