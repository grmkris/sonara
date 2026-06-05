import type { LibraryFrame } from "@sonara/shared";
import type { StateCreator } from "zustand";

import { rpcClient } from "@/lib/orpc";

import type { VisualizerState } from "./types";

// The user's persisted timeline. Bootstraps via library.list on WS open;
// extends via library.appended events as new frames land. Newest-first
// in-memory order so the timeline UI can render directly without sorting.
//
// `frames` is the canonical store; `cursor` is the next-page anchor (last
// frame's createdAt ISO string) or null when fully loaded. `bootstrapped`
// flips to true after the first list call resolves so the UI can tell
// "no frames yet" apart from "still loading."
export interface LibrarySlice {
  libraryFrames: LibraryFrame[];
  libraryCursor: string | null;
  libraryLoading: boolean;
  libraryBootstrapped: boolean;
  libraryHasMore: boolean;

  // Prepend a frame from a library.appended WS event. Dedupes by id so a
  // race between bootstrap and a fresh append doesn't insert twice.
  libraryAppendFromEvent: (frame: LibraryFrame) => void;
  // Initial fetch — called by use-ws-session once per authed connection.
  libraryBootstrap: () => Promise<void>;
  // Pagination — called when the user scrolls toward the right edge
  // (oldest) of the strip.
  libraryLoadMore: () => Promise<void>;
  // Forget everything — called on sign-out so the next user doesn't see
  // the previous one's library.
  libraryReset: () => void;
}

export const createLibrarySlice: StateCreator<
  VisualizerState,
  [],
  [],
  LibrarySlice
> = (set, get) => ({
  libraryAppendFromEvent: (frame) => {
    set((s) => {
      if (s.libraryFrames.some((f) => f.id === frame.id)) return {};
      return { libraryFrames: [frame, ...s.libraryFrames] };
    });
  },
  libraryBootstrap: async () => {
    if (get().libraryLoading) return;
    set({ libraryLoading: true });
    try {
      const { frames, nextCursor } = await rpcClient.library.list({});
      set((s) => {
        // Merge, don't replace: a library.appended event can land during the
        // await above and prepend a frame. Wholesale replace would drop it.
        // Dedupe by id, newest-first.
        const seen = new Set<string>();
        const merged: LibraryFrame[] = [];
        for (const f of [...s.libraryFrames, ...frames]) {
          if (seen.has(f.id)) continue;
          seen.add(f.id);
          merged.push(f);
        }
        merged.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return {
          libraryFrames: merged,
          libraryCursor: nextCursor,
          libraryHasMore: nextCursor !== null,
          libraryBootstrapped: true,
          libraryLoading: false,
        };
      });
    } catch (err) {
      console.warn("[library] bootstrap failed", err);
      set({ libraryLoading: false, libraryBootstrapped: true });
    }
  },
  libraryBootstrapped: false,
  libraryCursor: null,
  libraryFrames: [],
  libraryHasMore: false,
  libraryLoadMore: async () => {
    const { libraryLoading, libraryCursor, libraryHasMore } = get();
    if (libraryLoading || !libraryHasMore || !libraryCursor) return;
    set({ libraryLoading: true });
    try {
      const { frames, nextCursor } = await rpcClient.library.list({
        cursor: libraryCursor,
      });
      set((s) => ({
        // Append (oldest end) — pagination walks backwards through time.
        libraryFrames: [...s.libraryFrames, ...frames],
        libraryCursor: nextCursor,
        libraryHasMore: nextCursor !== null,
        libraryLoading: false,
      }));
    } catch (err) {
      console.warn("[library] loadMore failed", err);
      set({ libraryLoading: false });
    }
  },
  libraryLoading: false,
  libraryReset: () => {
    set({
      libraryFrames: [],
      libraryCursor: null,
      libraryLoading: false,
      libraryBootstrapped: false,
      libraryHasMore: false,
    });
  },
});
