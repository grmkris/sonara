import { z } from "zod";

export const RenderState = z.object({
  zoom: z.number(),
  bloom: z.number(),
  warp: z.number(),
  blur: z.number(),
  paletteShift: z.number(),
  motionEnergy: z.number(),
});

export type RenderState = z.infer<typeof RenderState>;

export const defaultRender: RenderState = {
  zoom: 1,
  bloom: 0.15,
  warp: 0,
  blur: 0.1,
  paletteShift: 0,
  motionEnergy: 0,
};
