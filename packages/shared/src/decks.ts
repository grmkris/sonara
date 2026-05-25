import { z } from "zod";

// Curated decks for DEMO mode. Adding a key here is the only schema change
// needed to enable a new deck — seed prompts live in
// apps/server/scripts/library-manifest.json, image rows live in the
// image_library table.
export const DECKS = [
  { key: "wild", label: "Wild Things" },
  { key: "cute", label: "Cute Crush" },
  { key: "sky", label: "Skyscapes" },
  { key: "liquid", label: "Liquid" },
  { key: "deep", label: "Deep" },
  { key: "bloom", label: "Bloom" },
  { key: "sacred", label: "Sacred" },
  { key: "neon", label: "Neon" },
  { key: "cyborg", label: "Cyborg" },
] as const;

export type DeckKey = (typeof DECKS)[number]["key"];

export const DECK_KEYS: readonly DeckKey[] = DECKS.map((d) => d.key);

export const DeckKeySchema = z.enum(
  DECKS.map((d) => d.key) as [DeckKey, ...DeckKey[]],
);
