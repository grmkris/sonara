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
  {
    key: "wild",
    label: "Wild Things",
    style: "untamed wildlife, raw primal nature",
  },
  {
    key: "cute",
    label: "Cute Crush",
    style: "adorable creatures, soft pastel, charming",
  },
  {
    key: "sky",
    label: "Skyscapes",
    style: "vast skies, drifting clouds, luminous air",
  },
  {
    key: "liquid",
    label: "Liquid",
    style: "flowing liquid, fluid motion, glossy reflections",
  },
  {
    key: "deep",
    label: "Deep",
    style: "deep dark ocean, abyssal, bioluminescent",
  },
  {
    key: "bloom",
    label: "Bloom",
    style: "blossoming flowers, lush botanical, vivid petals",
  },
  {
    key: "sacred",
    label: "Sacred",
    style: "sacred geometry, temples and ritual, golden reverence",
  },
  {
    key: "neon",
    label: "Neon",
    style: "neon glow, electric night, saturated cyberpunk",
  },
  {
    key: "cyborg",
    label: "Cyborg",
    style: "chrome androids, neon strobe, wet reflections",
  },
  {
    key: "noir",
    label: "Noir",
    style:
      "moody nocturnal noir, low-key candle and moonlight, charcoal and slate blue, muted, desaturated, no neon",
  },
  // ── ALTNEXT 2026 show decks (unlisted — see UNLISTED_DECK_KEYS below) ──
  // One deck per phase of the Sonicite 20-min A/V set (AltNext Season 2,
  // Shanghai). Energy arc 30% → 85% → 45%; palette is deep violet/indigo +
  // electric teal, with rose gold only in 04 and sapphire pressure in 06.
  {
    key: "alt01",
    label: "Altnext 01 · Emergence",
    style: "slow violet particle haze, deep indigo void, machine waking",
  },
  {
    key: "alt02",
    label: "Altnext 02 · Signal",
    style:
      "city light data columns, deep blue night, teal signal glow, futuristic nostalgia",
  },
  {
    key: "alt03",
    label: "Altnext 03 · Lattice",
    style: "geometric lattice and spiral light trails, indigo space, teal mist",
  },
  {
    key: "alt04",
    label: "Altnext 04 · Rose",
    style:
      "iridescent glass landscape, indigo to rose gold gradient, dreamy melancholic",
  },
  {
    key: "alt05",
    label: "Altnext 05 · Surge",
    style:
      "liquid metal and rain-soaked city lights, violet and teal reflections, kinetic",
  },
  {
    key: "alt06",
    label: "Altnext 06 · Pressure",
    style:
      "swirling liquid metal vortex, sapphire to violet iridescence, dense pressure",
  },
  {
    key: "alt07",
    label: "Altnext 07 · Resolve",
    style: "drifting glass fragments, minimal horizon, deep indigo, dissolving",
  },
  {
    key: "alt08",
    label: "Altnext 08 · Open End",
    style:
      "lone silhouette before a luminous horizon, near black, violet mist, unresolved",
  },
] as const;

export type DeckKey = (typeof DECKS)[number]["key"];

export const DECK_KEYS: readonly DeckKey[] = DECKS.map((d) => d.key);

export const DeckKeySchema = z.enum(
  DECKS.map((d) => d.key) as [DeckKey, ...DeckKey[]]
);

// Style descriptor for a deck, or "" if unknown. Used as a drift modifier on
// live generation after leaving the deck (see Session.goLive / trigger()).
export const deckStyle = (key: DeckKey): string =>
  DECKS.find((d) => d.key === key)?.style ?? "";

// Human-facing label for a deck, or "" if unknown. The DeckPicker shows it on
// the deck chips; the look badge under the wordmark shows it too.
export const deckLabel = (key: DeckKey): string =>
  DECKS.find((d) => d.key === key)?.label ?? "";

// A deck's full "look profile" — the render preset, default audio-reactivity
// intensity, and frame cadence (ms held at intensity 0 / 1). Applied as a unit
// when the deck is picked (see DeckPicker), so a deck's whole vibe travels
// together rather than being three knobs to set by hand.
export interface DeckLook {
  preset: VisualPresetName;
  // 0..1, default scene intensity for this deck
  intensity: number;
  // ms per frame at intensity 0 / 1
  cadence: { calm: number; loud: number };
}

// App-default cadence (used by decks without a DECK_LOOK entry): calm 6s → loud 2s.
export const DEFAULT_CADENCE = { calm: 6000, loud: 2000 } as const;

// Per-deck look overrides. Decks NOT listed here keep the app defaults
// (global `rave` preset + DEFAULT_CADENCE) — so adding an entry is opt-in and
// doesn't disturb the other decks.
export const DECK_LOOK: Partial<Record<DeckKey, DeckLook>> = {
  // ALTNEXT phases — picking the deck IS the phase change: preset, reactivity
  // and cadence ramp together along the set's 30% → 85% → 45% energy arc.
  alt01: {
    cadence: { calm: 12_000, loud: 7000 },
    intensity: 0.15,
    preset: "dust",
  },
  alt02: {
    cadence: { calm: 9000, loud: 4500 },
    intensity: 0.4,
    preset: "copper_wire",
  },
  alt03: {
    cadence: { calm: 7000, loud: 3500 },
    intensity: 0.55,
    preset: "long_exposure",
  },
  alt04: {
    cadence: { calm: 6000, loud: 3000 },
    intensity: 0.6,
    preset: "tide_pool",
  },
  alt05: {
    cadence: { calm: 5000, loud: 2500 },
    intensity: 0.7,
    preset: "storm",
  },
  alt06: {
    cadence: { calm: 4000, loud: 2000 },
    intensity: 0.85,
    preset: "rave",
  },
  alt07: {
    cadence: { calm: 9000, loud: 5000 },
    intensity: 0.4,
    preset: "ash_field",
  },
  alt08: {
    cadence: { calm: 12_000, loud: 8000 },
    intensity: 0.2,
    preset: "noir",
  },
  // The robo party: punchy, fast, bright. This was already the implicit app
  // default — made explicit so it survives the Noir coupling below.
  cyborg: { cadence: { ...DEFAULT_CADENCE }, intensity: 0.8, preset: "rave" },
  // The anti-rave: chill, dark, slow. Long holds, low reactivity, the `noir`
  // preset's no-strobe nocturne. Built for the movie room.
  noir: {
    cadence: { calm: 12_000, loud: 7000 },
    intensity: 0.15,
    preset: "noir",
  },
};

// ── Unlisted decks ──────────────────────────────────────────────────────
// Unlisted decks are real builtin decks (seeded, playable by key) that stay
// out of the public picker and the anon random rotation. They exist for
// show-specific collections (currently the ALTNEXT set) that shouldn't
// clutter the product for everyone. Unlisted ≠ secret: anyone holding the
// key can still select it via the API, which is fine for this purpose.
export const UNLISTED_DECK_KEYS: readonly DeckKey[] = [
  "alt01",
  "alt02",
  "alt03",
  "alt04",
  "alt05",
  "alt06",
  "alt07",
  "alt08",
];

export const isDeckUnlisted = (key: DeckKey): boolean =>
  UNLISTED_DECK_KEYS.includes(key);

// Decks shown to everyone — the picker default and the anon-session pool.
export const LISTED_DECK_KEYS: readonly DeckKey[] = DECK_KEYS.filter(
  (k) => !isDeckUnlisted(k)
);

// Accounts that see unlisted decks in the picker (matched on the signed-in
// user's email, lowercased).
export const UNLISTED_DECK_OPERATORS: readonly string[] = [
  "brenda@sonicite.ai",
  "kristjan.grm1@gmail.com",
];

export const canSeeUnlistedDecks = (
  email: string | null | undefined
): boolean => !!email && UNLISTED_DECK_OPERATORS.includes(email.toLowerCase());
