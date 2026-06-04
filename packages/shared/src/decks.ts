import { z } from "zod";
import type { VisualPresetName } from "./visual-presets";

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
  { key: "noir", label: "Noir", style: "moody nocturnal noir, low-key candle and moonlight, charcoal and slate blue, muted, desaturated, no neon" },
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

// A deck's full "look profile" — the render preset, default audio-reactivity
// intensity, and frame cadence (ms held at intensity 0 / 1). Applied as a unit
// when the deck is picked (see DeckPicker), so a deck's whole vibe travels
// together rather than being three knobs to set by hand.
export interface DeckLook {
  preset: VisualPresetName;
  intensity: number; // 0..1, default scene intensity for this deck
  cadence: { calm: number; loud: number }; // ms per frame at intensity 0 / 1
}

// App-default cadence (used by decks without a DECK_LOOK entry): calm 6s → loud 2s.
export const DEFAULT_CADENCE = { calm: 6_000, loud: 2_000 } as const;

// Per-deck look overrides. Decks NOT listed here keep the app defaults
// (global `rave` preset + DEFAULT_CADENCE) — so adding an entry is opt-in and
// doesn't disturb the other decks.
export const DECK_LOOK: Partial<Record<DeckKey, DeckLook>> = {
  // The robo party: punchy, fast, bright. This was already the implicit app
  // default — made explicit so it survives the Noir coupling below.
  cyborg: { preset: "rave", intensity: 0.8, cadence: { ...DEFAULT_CADENCE } },
  // The anti-rave: chill, dark, slow. Long holds, low reactivity, the `noir`
  // preset's no-strobe nocturne. Built for the movie room.
  noir: { preset: "noir", intensity: 0.15, cadence: { calm: 12_000, loud: 7_000 } },
};
