import {
  cadenceBetweenMs,
  clampFrameDurationMs,
  libraryCadenceMs,
} from "@sonara/shared";
import type { DeckKey, LibraryManifest } from "@sonara/shared";
import { useEffect } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

const LRU = 10;
const FIXED_CADENCE_MS = 2500;
const MIN_CADENCE_MS = 600;
const MAX_CADENCE_MS = 6000;

// Per-deck manifest cache. Fetched once per deck per page load and kept in
// memory so re-activation (or a network drop mid-session) still has the URL
// list. The Service Worker also caches the manifest at the HTTP layer — keep
// this exact fetch URL: it's the offline path a live show depends on.
const manifestCache = new Map<string, string[]>();

const loadManifest = async (deck: string): Promise<string[]> => {
  const cached = manifestCache.get(deck);
  if (cached) {
    return cached;
  }
  try {
    const res = await fetch(`/library/${deck}/manifest.json`);
    if (!res.ok) {
      return [];
    }
    const data = (await res.json()) as Partial<LibraryManifest>;
    const frames = Array.isArray(data.frames) ? data.frames : [];
    manifestCache.set(deck, frames);
    return frames;
  } catch {
    return [];
  }
};

// Recording replay: reconstruct the live timing from tMs deltas, clamped so a
// long pause doesn't stall the replay and a rapid burst doesn't strobe.
const originalCadenceMs = (
  cur: { tMs: number } | undefined,
  next: { tMs: number } | undefined
): number => {
  if (!(cur && next)) {
    return FIXED_CADENCE_MS;
  }
  const delta = next.tMs - cur.tMs;
  if (delta <= 0) {
    return FIXED_CADENCE_MS;
  }
  return Math.min(MAX_CADENCE_MS, Math.max(MIN_CADENCE_MS, delta));
};

/**
 * THE client-side frame producer for every non-live source — the merged
 * successor of use-demo-frame-loop (decks) and the old set replay loop. One
 * producer, one version-guard, no cross-loop standoffs:
 *
 *   deck            static manifest, shuffle-no-repeat, reactive cadence
 *                   (DECK_LOOK bounds × live intensity)
 *   set (builtin)   the manifest behind its deckKey — same as a deck, with
 *                   the set's authored look bounds when present
 *   set (recording) ordered fetched frames on their original tMs timing
 *   set (curated)   ordered fetched frames; authored-look reactive cadence,
 *                   else a fixed beat
 *
 * Mounted once per producing surface (/play screens, the marketing
 * backplate, the /set replay page).
 */
export const usePlaybackLoop = (): void => {
  const source = useVisualizerStore((s) => s.source);
  const playbackFrames = useVisualizerStore((s) => s.playbackFrames);

  useEffect(() => {
    const store = useVisualizerStore;
    // The frame producer is changing (idle / server live-gen ↔ this loop).
    // Reset the monotonic guard so neither side's frames get rejected as
    // stale by pushFrame.
    store.getState().resetFrameVersion();

    if (source.kind === "live" || source.kind === "idle") {
      return;
    }

    // Resolve the frame strategy from the source.
    const { look, origin } = source;
    const manifestDeck = source.deckKey ?? null;

    const cadenceMs = (
      idx: number,
      frames: { tMs: number; durationMs?: number | null }[]
    ): number => {
      const { intensity } = store.getState().scene;
      // Authored per-frame hold (curated-set timeline trim) wins — WYSIWYG: the
      // clip's width on the timeline is exactly how long it shows. Frames
      // without a pinned duration fall back to the reactive cadence below.
      const pinned = frames[idx]?.durationMs;
      if (typeof pinned === "number") {
        return clampFrameDurationMs(pinned);
      }
      if (origin === "recording") {
        return originalCadenceMs(
          frames[idx],
          frames[(idx + 1) % frames.length]
        );
      }
      if (look) {
        return cadenceBetweenMs(intensity, look.cadence);
      }
      if (manifestDeck) {
        // Builtin set without an authored look — the deck's reactive
        // cadence profile (pre-collapse parity).
        return libraryCadenceMs(intensity, manifestDeck as DeckKey);
      }
      return FIXED_CADENCE_MS;
    };

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const push = (url: string, version: number) => {
      const s = store.getState();
      s.pushFrame(url, version);
      s.pushHero(url);
    };

    if (manifestDeck) {
      // Manifest-backed playback: an unordered frame pool, shuffled with a
      // small no-repeat window (mirrors the old demo loop / server provider).
      let recent: string[] = [];
      let localVersion = 0;
      let frames: string[] = [];

      const tick = () => {
        if (cancelled) {
          return;
        }
        if (frames.length > 0) {
          let candidates = frames.filter((f) => !recent.includes(f));
          if (candidates.length === 0) {
            candidates = frames;
          }
          const url = candidates[
            Math.floor(Math.random() * candidates.length)
          ] as string;
          recent = [url, ...recent.filter((f) => f !== url)].slice(0, LRU);
          localVersion += 1;
          push(url, localVersion);
        }
        timer = setTimeout(tick, cadenceMs(0, []));
      };

      void (async () => {
        const f = await loadManifest(manifestDeck);
        if (cancelled) {
          return;
        }
        frames = f;
        tick();
      })();
    } else {
      // Ordered playback of fetched set frames.
      const frames = playbackFrames;
      let idx = 0;
      let localVersion = 0;

      const tick = () => {
        if (cancelled || frames.length === 0) {
          return;
        }
        const frame = frames[idx];
        if (frame) {
          localVersion += 1;
          push(frame.url, localVersion);
        }
        const wait = cadenceMs(idx, frames);
        idx = (idx + 1) % frames.length;
        timer = setTimeout(tick, wait);
      };

      tick();
    }

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [source, playbackFrames]);
};
