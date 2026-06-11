// Text-mode image models the live session can A/B from the studio. The KEY
// (not the raw fal id) is the wire value: the server validates the dropdown
// choice against this allowlist and looks up the fal endpoint + payload config
// here, so a client can never drive an arbitrary fal model. Mirrors the
// `visual-presets.ts` pattern — names/config in `shared`, consumed by both the
// server (generation) and the web client (the picker).
//
// `transport` selects the code path:
//   • "realtime" → fal.realtime.connect (warm per-session websocket, ~150-300ms
//     warm floor; bypasses the queue). This is the speed win.
//   • "queue"    → fal.subscribe (the original klein/9b path; multi-second, but
//     kept as the quality baseline the realtime models are A/B'd against).
//
// To add a model: append an entry here. Realtime models MUST expose fal's
// realtime websocket endpoint (verified on the model's fal.ai/models/.../api
// page — "This model has a real-time mode via websockets") AND return
// `images[].url` when `sync_mode:false`, or the URL-based pipeline breaks.

import { z } from "zod";

export const TEXT_MODEL_KEYS = ["lightning-sdxl", "klein-9b"] as const;

export type TextModelKey = (typeof TEXT_MODEL_KEYS)[number];

export interface TextModelConfig {
  // fal endpoint id passed to subscribe()/realtime.connect().
  falId: string;
  // Short label + blurb for the studio dropdown.
  label: string;
  blurb: string;
  transport: "realtime" | "queue";
  // Image-to-image variant of this model, when one exists. Presence of this
  // field IS the "frames can chain" capability: the live pipeline conditions
  // each keyframe on the previous one via this endpoint (queue transport
  // only). Absent → plain t2i every frame.
  editFalId?: string;
  // num_inference_steps. Realtime distills want 4-6; klein's documented min is 4.
  steps: number;
  // CFG scale. Omitted for models that don't take one (lightning-sdxl, klein).
  guidanceScale?: number;
}

// NOTE: keys are alphabetical to satisfy sort-keys; the studio DROPDOWN order
// is driven by TEXT_MODEL_KEYS above.
export const TEXT_MODELS: Record<TextModelKey, TextModelConfig> = {
  "klein-9b": {
    blurb: "queue · quality default",
    editFalId: "fal-ai/flux-2/klein/9b/edit",
    falId: "fal-ai/flux-2/klein/9b",
    label: "Klein 9B",
    steps: 4,
    transport: "queue",
  },
  "lightning-sdxl": {
    blurb: "realtime · balanced",
    falId: "fal-ai/fast-lightning-sdxl",
    label: "Lightning SDXL",
    steps: 4,
    transport: "realtime",
  },
};

export const TextModelKeySchema = z.enum(TEXT_MODEL_KEYS);

// Default for new live sessions. klein/9b is the quality pick and the
// day-to-day default; lightning-sdxl stays available behind the ?lab=1
// model A/B for latency experiments.
export const DEFAULT_TEXT_MODEL: TextModelKey = "klein-9b";

// Render resolutions the studio can A/B. Both realtime models accept custom
// {width,height}; we keep it to a small square set. 512² roughly halves the
// pixels (and the payload) vs 768², for lower latency.
export const RENDER_RESOLUTIONS = [512, 768] as const;
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number];
export const RenderResolutionSchema = z.union([z.literal(512), z.literal(768)]);
export const DEFAULT_RESOLUTION: RenderResolution = 512;
