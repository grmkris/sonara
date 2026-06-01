import { z } from "zod";

// Curated decks for DEMO mode. Adding a key here is the only schema change
// needed to enable a new deck — seed prompts live in
// apps/server/scripts/library-manifest.json, image rows live in the
// image_library table.
//
// `style` is a short descriptor of the deck's look. When a session leaves the
// deck and goes live (see Session.goLive), the deck it came from keeps nudging
// generation toward its vibe by feeding `style` into the prompt drift — so the
// user's typed scene rendered "in the cyborg deck's world" still reads on-theme.
export const DECKS = [
  { key: "wild", label: "Wild Things", style: "untamed wildlife, raw primal nature" },
  { key: "cute", label: "Cute Crush", style: "adorable creatures, soft pastel, charming" },
  { key: "sky", label: "Skyscapes", style: "vast skies, drifting clouds, luminous air" },
  { key: "liquid", label: "Liquid", style: "flowing liquid, fluid motion, glossy reflections" },
  { key: "deep", label: "Deep", style: "deep dark ocean, abyssal, bioluminescent" },
  { key: "bloom", label: "Bloom", style: "blossoming flowers, lush botanical, vivid petals" },
  { key: "sacred", label: "Sacred", style: "sacred geometry, temples and ritual, golden reverence" },
  { key: "neon", label: "Neon", style: "neon glow, electric night, saturated cyberpunk" },
  { key: "cyborg", label: "Cyborg", style: "chrome androids, neon strobe, wet reflections" },
] as const;

export type DeckKey = (typeof DECKS)[number]["key"];

export const DECK_KEYS: readonly DeckKey[] = DECKS.map((d) => d.key);

export const DeckKeySchema = z.enum(
  DECKS.map((d) => d.key) as [DeckKey, ...DeckKey[]],
);

// Style descriptor for a deck, or "" if unknown. Used as a drift modifier on
// live generation after leaving the deck (see Session.goLive / trigger()).
export function deckStyle(key: DeckKey): string {
  return DECKS.find((d) => d.key === key)?.style ?? "";
}

// Human-facing label for a deck, or "" if unknown. The DeckPicker shows it on
// the deck chips; the look badge under the wordmark shows it too.
export function deckLabel(key: DeckKey): string {
  return DECKS.find((d) => d.key === key)?.label ?? "";
}
