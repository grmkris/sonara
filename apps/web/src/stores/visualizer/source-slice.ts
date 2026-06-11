import { DECK_KEYS } from "@sonara/shared";
import type {
  DeckKey,
  FrameSetOrigin,
  LibraryFrame,
  SetLook,
} from "@sonara/shared";
import type { StateCreator } from "zustand";

import type { VisualizerState } from "./types";

export const SOURCE_KEY = "viz_source";
// Pre-unification keys, migrated by readSourcePref then removed.
const LEGACY_DEMO_MODE_KEY = "viz_demo_mode";
const LEGACY_DEMO_DECK_KEY = "viz_demo_deck";

// The client's playback source — the demoMode/demoDeck + set-playback
// successor. ONE field decides what produces frames:
//   idle  nothing plays (canvas holds its last frame)
//   live  server generation produces (WS frame events)
//   deck  the playback loop cycles the deck's static manifest
//   set   the playback loop plays an ordered fetched frame list (or, for
//         builtin sets, the deck manifest behind their deckKey)
export type PlaybackSource =
  | { kind: "idle" }
  | { kind: "live" }
  | { kind: "deck"; deck: DeckKey }
  | {
      kind: "set";
      setId: string;
      name: string | null;
      // Builtin sets: the static-manifest deck behind this set (playback
      // stays offline-capable). Null for recordings/cuts.
      deckKey: string | null;
      origin: FrameSetOrigin;
      look: SetLook | null;
    };

export interface SourceSlice {
  source: PlaybackSource;
  // Ordered frames for set-kind playback (from sets.get). Deck-kind and
  // builtin-set playback read static manifests instead. Transient.
  playbackFrames: LibraryFrame[];

  setSource: (source: PlaybackSource, frames?: LibraryFrame[]) => void;
  // ■ stop → idle. The canvas holds its last frame; the reporter tells the
  // server.
  stopToIdle: () => void;
}

const persistSource = (source: PlaybackSource): void => {
  if (typeof window === "undefined") {
    return;
  }
  // Only deck/idle survive a reload: live needs a server session and set
  // replays are session-scoped (frames aren't persisted).
  if (source.kind === "deck" || source.kind === "idle") {
    window.localStorage.setItem(SOURCE_KEY, JSON.stringify(source));
  }
};

export const createSourceSlice: StateCreator<
  VisualizerState,
  [],
  [],
  SourceSlice
> = (set) => ({
  playbackFrames: [],
  setSource: (source, frames) => {
    set({ playbackFrames: frames ?? [], source });
    persistSource(source);
  },
  source: { kind: "idle" },
  stopToIdle: () => {
    set({ playbackFrames: [], source: { kind: "idle" } });
    persistSource({ kind: "idle" });
  },
});

// Post-mount hydration value (SSR renders idle). Migrates the pre-unification
// viz_demo_mode/viz_demo_deck keys on first read, then removes them.
export const readSourcePref = (): PlaybackSource | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SOURCE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<PlaybackSource>;
      if (parsed.kind === "idle") {
        return { kind: "idle" };
      }
      if (
        parsed.kind === "deck" &&
        "deck" in parsed &&
        (DECK_KEYS as readonly string[]).includes(parsed.deck as string)
      ) {
        return { deck: parsed.deck as DeckKey, kind: "deck" };
      }
    } catch {
      // corrupt value — fall through to the legacy keys
    }
  }
  const m = window.localStorage.getItem(LEGACY_DEMO_MODE_KEY);
  const d = window.localStorage.getItem(LEGACY_DEMO_DECK_KEY);
  window.localStorage.removeItem(LEGACY_DEMO_MODE_KEY);
  window.localStorage.removeItem(LEGACY_DEMO_DECK_KEY);
  if (m === "1" && d && (DECK_KEYS as readonly string[]).includes(d)) {
    const migrated: PlaybackSource = { deck: d as DeckKey, kind: "deck" };
    persistSource(migrated);
    return migrated;
  }
  return null;
};
