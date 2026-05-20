import type { StateCreator } from "zustand";
import type { VisualizerState } from "./types";

// User-uploaded image-anchor state. Holds the fal-hosted URL (set after
// upload succeeds), the chosen strength preset, an upload-in-flight flag,
// and a localStorage-backed clickwrap consent. The actual scene-state
// mutation goes through the oRPC `setImageAnchor` mutation — this slice
// is just the UI mirror so the upload zone re-renders correctly.

export const ANCHOR_CLICKWRAP_KEY = "viz_anchor_clickwrap";

export type StrengthPreset = "style-only" | "style-subject" | "lock-subject";

export const STRENGTH_PRESET_VALUES: Record<StrengthPreset, number> = {
  "style-only": 0.3,
  "style-subject": 0.55,
  "lock-subject": 0.8,
};

export const STRENGTH_PRESET_LABELS: Record<StrengthPreset, string> = {
  "style-only": "style only",
  "style-subject": "style + subject",
  "lock-subject": "lock subject",
};

export type UploadState = "idle" | "uploading" | "error";

export interface ImageAnchorSlice {
  /** Locally-known image URL — set after upload + server confirm. Mirrors
   *  scene.imageAnchor.url from scene-state events. */
  anchorImageUrl: string | null;
  /** Local optimistic thumbnail from URL.createObjectURL during upload. */
  anchorLocalPreview: string | null;
  /** Active preset. Drives `image_prompt_strength` server-side. */
  strengthPreset: StrengthPreset;
  /** True after the user has accepted the upload-rights clickwrap. */
  clickwrapAccepted: boolean;
  /** Multipart-upload-in-flight indicator. */
  uploadState: UploadState;

  setAnchorImageUrl: (url: string | null) => void;
  setAnchorLocalPreview: (url: string | null) => void;
  setStrengthPreset: (preset: StrengthPreset) => void;
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
  anchorImageUrl: null,
  anchorLocalPreview: null,
  strengthPreset: "style-subject",
  clickwrapAccepted: false,
  uploadState: "idle",

  setAnchorImageUrl: (url) => set({ anchorImageUrl: url }),
  setAnchorLocalPreview: (url) => set({ anchorLocalPreview: url }),
  setStrengthPreset: (preset) => set({ strengthPreset: preset }),
  acceptClickwrap: () => {
    set({ clickwrapAccepted: true });
    if (typeof window !== "undefined") {
      window.localStorage.setItem(ANCHOR_CLICKWRAP_KEY, "1");
    }
  },
  setUploadState: (s) => set({ uploadState: s }),
  clearAnchor: () =>
    set({
      anchorImageUrl: null,
      anchorLocalPreview: null,
      uploadState: "idle",
    }),
});

export function readClickwrapAccepted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(ANCHOR_CLICKWRAP_KEY) === "1";
}
