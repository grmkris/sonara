import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

// User-uploaded image state — now a one-shot CHAIN SEED: the next generated
// keyframe morphs out of this image (klein/9b/edit), then the live chain
// takes over. Holds the fal-hosted URL (set after upload succeeds), an
// upload-in-flight flag, and a localStorage-backed clickwrap consent. The
// actual scene-state mutation goes through the oRPC `setImageAnchor`
// mutation — this slice is just the UI mirror so the upload zone re-renders
// correctly. (The ultra-era strength presets are gone: the edit model is
// prompt-driven.)

export const ANCHOR_CLICKWRAP_KEY = "viz_anchor_clickwrap";

export type UploadState = "idle" | "uploading" | "error";

export interface ImageAnchorSlice {
  /** Locally-known image URL — set after upload + server confirm. Mirrors
   *  scene.imageAnchor.url from scene-state events. */
  anchorImageUrl: string | null;
  /** Local optimistic thumbnail from URL.createObjectURL during upload. */
  anchorLocalPreview: string | null;
  /** True after the user has accepted the upload-rights clickwrap. */
  clickwrapAccepted: boolean;
  /** Multipart-upload-in-flight indicator. */
  uploadState: UploadState;

  setAnchorImageUrl: (url: string | null) => void;
  setAnchorLocalPreview: (url: string | null) => void;
  acceptClickwrap: () => void;
  setUploadState: (s: UploadState) => void;
  clearAnchor: () => void;
}

export const createImageAnchorSlice: StateCreator<
  VisualizerState,
  [],
  [],
  ImageAnchorSlice
> = (set) => ({
  acceptClickwrap: () => {
    set({ clickwrapAccepted: true });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ANCHOR_CLICKWRAP_KEY, "1");
    }
  },
  anchorImageUrl: null,
  anchorLocalPreview: null,
  clearAnchor: () =>
    set({
      anchorImageUrl: null,
      anchorLocalPreview: null,
      uploadState: "idle",
    }),
  clickwrapAccepted: false,
  setAnchorImageUrl: (url) => set({ anchorImageUrl: url }),
  setAnchorLocalPreview: (url) => set({ anchorLocalPreview: url }),
  setUploadState: (s) => set({ uploadState: s }),
  uploadState: "idle",
});

export const readClickwrapAccepted = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(ANCHOR_CLICKWRAP_KEY) === "1";
};
