import { z } from "zod";

import { AudioFeatures } from "./audio";
import { ExperienceConfig, MusicalFrame, ResponsiveConfig } from "./experience";

export const WorldId = z.enum([
  "dream",
  "liquid",
  "mycelium",
  "cosmos",
  "fractal",
  "mirror",
]);
export type WorldId = z.infer<typeof WorldId>;
export const MacroId = z.enum(["energy", "flow", "symmetry", "trails"]);
export type MacroId = z.infer<typeof MacroId>;
const unit = z.number().min(0).max(1);
export const InstrumentMacros = z.object({
  energy: unit,
  flow: unit,
  symmetry: unit,
  trails: unit,
});
export type InstrumentMacros = z.infer<typeof InstrumentMacros>;
export const WorldSlot = z.object({
  look: z.number().int().min(0).max(2),
  macros: InstrumentMacros,
  world: WorldId,
});
export type WorldSlot = z.infer<typeof WorldSlot>;
export const InstrumentConfig = z.object({
  a: WorldSlot,
  b: WorldSlot,
  blend: z.enum(["mix", "add", "mask"]),
  conductor: z.boolean(),
  crossfade: unit,
  palette: z.enum(["ember", "lagoon", "acid", "pearl"]),
  seed: z.number().int().min(0).max(2_147_483_647),
  version: z.literal(1),
});
export type InstrumentConfig = z.infer<typeof InstrumentConfig>;
export const EngineConfig = z.discriminatedUnion("version", [
  InstrumentConfig,
  ExperienceConfig,
  ResponsiveConfig,
]);
export type EngineConfig = z.infer<typeof EngineConfig>;
export const DEFAULT_INSTRUMENT: InstrumentConfig = {
  a: {
    look: 0,
    macros: { energy: 0.55, flow: 0.45, symmetry: 0.2, trails: 0.6 },
    world: "liquid",
  },
  b: {
    look: 0,
    macros: { energy: 0.5, flow: 0.4, symmetry: 0.4, trails: 0.65 },
    world: "cosmos",
  },
  blend: "mix",
  conductor: false,
  crossfade: 0,
  palette: "ember",
  seed: 7331,
  version: 1,
};
export const AudioFeatureFrame = z.object({
  confidence: unit,
  features: AudioFeatures,
  music: MusicalFrame.optional(),
  time: z.number().nonnegative(),
});
export type AudioFeatureFrame = z.infer<typeof AudioFeatureFrame>;
export const Attractor = z.object({
  force: z.number().min(-1).max(1),
  id: z.number().int().min(0).max(1).optional(),
  x: unit,
  y: unit,
});
export type Attractor = z.infer<typeof Attractor>;
export const PerformanceControlFrame = z.object({
  attractors: z.array(Attractor).max(2),
  expansion: unit,
  lift: z.number().min(-1).max(1).optional(),
  rotation: z.number().min(-Math.PI).max(Math.PI),
  time: z.number().nonnegative(),
});
export type PerformanceControlFrame = z.infer<typeof PerformanceControlFrame>;
export const TakeEvent = z.discriminatedUnion("kind", [
  z.object({
    control: PerformanceControlFrame,
    frame: MusicalFrame,
    kind: z.literal("motion"),
    simulationTime: z.number().nonnegative(),
    time: z.number().nonnegative(),
  }),
  z.object({
    config: EngineConfig,
    kind: z.literal("scene"),
    time: z.number().nonnegative(),
  }),
  z.object({
    frame: AudioFeatureFrame,
    kind: z.literal("audio"),
    time: z.number().nonnegative(),
  }),
  z.object({
    frame: PerformanceControlFrame,
    kind: z.literal("control"),
    time: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("image"),
    time: z.number().nonnegative(),
    url: z.string().max(2048),
  }),
  z.object({
    frozen: z.boolean(),
    kind: z.literal("freeze"),
    time: z.number().nonnegative(),
  }),
  z.object({ kind: z.literal("reset"), time: z.number().nonnegative() }),
]);
export type TakeEvent = z.infer<typeof TakeEvent>;
export const TakeManifest = z
  .object({
    config: EngineConfig,
    createdAt: z.string().datetime(),
    duration: z.number().nonnegative(),
    engine: z.enum(["sonara-1", "sonara-2", "sonara-3"]),
    id: z.string().uuid(),
    name: z.string().min(1).max(160),
    range: z
      .tuple([z.number().nonnegative(), z.number().positive()])
      .optional(),
    version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  })
  .refine(
    (take) =>
      take.engine === `sonara-${take.config.version}` &&
      take.version === take.config.version,
    { message: "Take engine and configuration versions must agree." }
  )
  .refine(
    (take) =>
      !take.range ||
      (take.range[0] < take.range[1] && take.range[1] <= take.duration),
    { message: "The playback range must fit inside the take." }
  );
export type TakeManifest = z.infer<typeof TakeManifest>;
