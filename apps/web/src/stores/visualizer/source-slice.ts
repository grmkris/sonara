import { DECK_KEYS, DECK_LOOK, deckLabel } from "@sonara/shared";
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

// The client's playback source. ONE field decides what produces frames:
//   idle  nothing plays (canvas holds its last frame)
//   live  server generation produces (WS frame events)
//   set   the playback loop plays an ordered fetched frame list (or, for
//         builtin sets, the static deck manifest behind their deckKey)
export type PlaybackSource =
  | { kind: "idle" }
  | { kind: "live" }
  | {
      kind: "set";
      // Null ONLY for client-native builtin picks (anon pin, offline rows,
      // the marketing backplate) — those surfaces can't know DB ids
      // (sets.list is protected) and play purely off deckKey.
      setId: string | null;
      name: string | null;
      // Builtin sets: the static-manifest deck behind this set (playback
      // stays offline-capable). Null for recordings/cuts.
      deckKey: string | null;
      origin: FrameSetOrigin;
      look: SetLook | null;
    };

export interface SourceSlice {
  source: PlaybackSource;
  // Ordered frames for set-kind playback (from sets.get). Builtin-set
  // playback reads static deck manifests instead. Transient.
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
  // Only builtin sets / idle survive a reload: live needs a server session,
  // and recording/cut replays are session-scoped (frames aren't persisted).
  // Builtins persist by deckKey alone (the look re-derives at read).
  if (source.kind === "idle") {
    window.localStorage.setItem(SOURCE_KEY, JSON.stringify(source));
  } else if (source.kind === "set" && source.deckKey) {
    window.localStorage.setItem(
      SOURCE_KEY,
      JSON.stringify({
        deckKey: source.deckKey,
        kind: "set",
        name: source.name,
        setId: source.setId,
      })
    );
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

// Post-mount hydration value (SSR renders idle).
export const readSourcePref = (): PlaybackSource | null => {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(SOURCE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as {
        kind?: string;
        deck?: string;
        deckKey?: string;
        name?: string | null;
        setId?: string | null;
      };
      if (parsed.kind === "idle") {
        return { kind: "idle" };
      }
      // Pre-collapse prefs stored {kind:"deck", deck} — migrate them to the
      // builtin-set shape (deckKey carries playback; look re-derives below).
      const deckKey =
        parsed.kind === "set" ? parsed.deckKey : (parsed.deck ?? undefined);
      if (deckKey && (DECK_KEYS as readonly string[]).includes(deckKey)) {
        const key = deckKey as DeckKey;
        return {
          deckKey: key,
          kind: "set",
          look: DECK_LOOK[key] ?? null,
          name: parsed.name ?? deckLabel(key),
          origin: "builtin",
          setId: parsed.setId ?? null,
        };
      }
    } catch {
      // corrupt value — treat as unset
    }
  }
  return null;
};
