import type { DeckKey } from "@sonara/shared";

export interface DemoTrack {
  url: string;
  title: string;
}

// Single shared track for now. To go per-deck later, swap to a
// Partial<Record<DeckKey, DemoTrack>> with this as the fallback.
export const DEFAULT_DEMO_TRACK: DemoTrack = {
  url: "/library/_audio/lantern-circuit.mp3",
  title: "Sonicite — Mu Shanghai Lantern Circuit",
};

export function getDemoTrack(_deck: DeckKey | null): DemoTrack {
  return DEFAULT_DEMO_TRACK;
}
