import type { EngineConfig, InstrumentMacros, WorldId } from "@sonara/shared";

export const WORLDS: {
  id: WorldId;
  name: string;
  description: string;
  looks: [string, string, string];
}[] = [
  {
    description: "Images that dream back",
    id: "dream",
    looks: ["Velvet portal", "Molten memory", "Prismatic dissolve"],
    name: "Dream",
  },
  {
    description: "Pigment with a pulse",
    id: "liquid",
    looks: ["Slow chemistry", "Solar tides", "Electric ink"],
    name: "Liquid",
  },
  {
    description: "A living nervous system",
    id: "mycelium",
    looks: ["Spore garden", "Neural lace", "Bloom state"],
    name: "Mycelium",
  },
  {
    description: "Gravity you can touch",
    id: "cosmos",
    looks: ["Orbital dust", "Magnetic bloom", "Event horizon"],
    name: "Cosmos",
  },
  {
    description: "Architecture without an end",
    id: "fractal",
    looks: ["Cathedral", "Infinite fold", "Through the iris"],
    name: "Fractal",
  },
  {
    description: "Become the material",
    id: "mirror",
    looks: ["Afterimage", "Contour body", "Light vessel"],
    name: "Mirror",
  },
];
export const PALETTES = {
  acid: ["#dfff52", "#fc5683", "#654dff"],
  ember: ["#ffb85c", "#ec5751", "#7474ed"],
  lagoon: ["#8cf3dc", "#5186fd", "#edb5fa"],
  pearl: ["#e9e1d1", "#afa7bc", "#668b93"],
} as const;
export const lookMacros = (look: number): InstrumentMacros =>
  [
    { energy: 0.4, flow: 0.3, symmetry: 0.15, trails: 0.65 },
    { energy: 0.65, flow: 0.5, symmetry: 0.5, trails: 0.8 },
    { energy: 0.8, flow: 0.7, symmetry: 0.8, trails: 0.4 },
  ][look] ?? { energy: 0.5, flow: 0.4, symmetry: 0.2, trails: 0.6 };

export const experienceLabel = (config: EngineConfig): string =>
  config.version === 2
    ? config.treatment
    : `${config.a.world} / ${config.b.world}`;
export const intensityOf = (config: EngineConfig): number =>
  config.version === 2 ? config.intensity : config.a.macros.energy;
