// Visual-preset NAMES and short descriptions live in `shared` so the server
// can reference them when asking the LLM to pick one, while the web client
// binds the same keys to concrete shader configs in `apps/web/.../presets.ts`.
// If you add/remove a preset, update BOTH this list AND `apps/web/src/lib/
// render/presets.ts` `PRESETS`.

export const VISUAL_PRESET_NAMES = [
  "wet_ink",
  "ember",
  "frost",
  "mandala",
  "dust",
  "storm",
  "silent_film",
  "neon_line",
  "paper_rain",
  "bone_china",
  "tide_pool",
  "struck_bell",
  "copper_wire",
  "ash_field",
  "knife_cut",
  "worn_linen",
  "salt_flat",
  "lacquer_screen",
  "cut_crystal",
  "long_exposure",
  "transfer_paper",
  "rave",
  "noir",
] as const;

export type VisualPresetName = (typeof VISUAL_PRESET_NAMES)[number];

export const VISUAL_PRESET_DESCRIPTIONS: Record<VisualPresetName, string> = {
  ash_field: "matte grey, slow decay",
  bone_china: "pale porcelain, hairline cracks",
  copper_wire: "hot filament edges on cool ground",
  cut_crystal: "faceted kaleido, sharp light",
  dust: "grainy, slow-motion, soft",
  ember: "burnt orange, volcanic glow",
  frost: "cool, minimal, cold edges",
  knife_cut: "hard slice, high-contrast edge",
  lacquer_screen: "deep black-red, glossy surface",
  long_exposure: "motion-blurred trails",
  mandala: "kaleidoscopic radial symmetry",
  neon_line: "stark signal/indigo, edges maximum",
  noir: "low-key nocturne, smooth dark trails, no strobe",
  paper_rain: "vertical drift, soft falling marks",
  rave: "hard, trippy, beat-slamming neon",
  salt_flat: "bleached, flat, almost still",
  silent_film: "duotone sepia, flickering posterize",
  storm: "aggressive, gritty, swirling",
  struck_bell: "single hit, radiating ring",
  tide_pool: "breathing blue-green, slow swirl",
  transfer_paper: "ink-transfer texture, slight misregister",
  wet_ink: "balanced sumi-e baseline",
  worn_linen: "soft weave, faded",
};
