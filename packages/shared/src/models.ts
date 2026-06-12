// Text-mode image models for the live session. The KEY (not the raw fal id)
// is the wire value: the server validates against this allowlist and looks up
// the fal endpoint + payload config here, so a client can never drive an
// arbitrary fal model. Mirrors the `visual-presets.ts` pattern — names/config
// in `shared`, consumed by both the server (generation) and the web client.
//
// All models run fal's queue (fal.subscribe). To add a model: append an entry
// here; it must return `images[].url`, or the URL-based pipeline breaks.

import { z } from "zod";

export const TEXT_MODEL_KEYS = ["klein-9b"] as const;

export type TextModelKey = (typeof TEXT_MODEL_KEYS)[number];

export interface TextModelConfig {
  // fal endpoint id passed to subscribe().
  falId: string;
  // Short label + blurb for the studio dropdown.
  label: string;
  blurb: string;
  // Image-to-image variant of this model, when one exists. Presence of this
  // field IS the "frames can chain" capability: the live pipeline conditions
  // each keyframe on the previous one via this endpoint. Absent → plain t2i
  // every frame.
  editFalId?: string;
  // num_inference_steps. klein's documented min is 4.
  steps: number;
  // CFG scale. Omitted for models that don't take one (klein).
  guidanceScale?: number;
}

export const TEXT_MODELS: Record<TextModelKey, TextModelConfig> = {
  "klein-9b": {
    blurb: "quality default",
    editFalId: "fal-ai/flux-2/klein/9b/edit",
    falId: "fal-ai/flux-2/klein/9b",
    label: "Klein 9B",
    steps: 4,
  },
};

export const TextModelKeySchema = z.enum(TEXT_MODEL_KEYS);

// Default for new live sessions.
export const DEFAULT_TEXT_MODEL: TextModelKey = "klein-9b";

// Render resolutions the studio can A/B (?lab=1). klein accepts custom
// {width,height}; we keep it to a small square set. 512² roughly halves the
// pixels (and the payload) vs 768², for lower latency.
export const RENDER_RESOLUTIONS = [512, 768] as const;
export type RenderResolution = (typeof RENDER_RESOLUTIONS)[number];
export const RenderResolutionSchema = z.union([z.literal(512), z.literal(768)]);
export const DEFAULT_RESOLUTION: RenderResolution = 512;
