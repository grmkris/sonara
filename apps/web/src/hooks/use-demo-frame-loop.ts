import { libraryCadenceMs } from "@sonara/shared";
import type { LibraryManifest } from "@sonara/shared";
import { useEffect } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

const LRU = 10;

// Per-deck manifest cache. Fetched once per deck per page load and kept in
// memory so re-activation (or a network drop mid-session) still has the URL
// list. The Service Worker also caches the manifest at the HTTP layer.
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

/**
 * Client-native demo loop. Demo no longer depends on the server/WebSocket:
 * the browser fetches the deck's static manifest and cycles its frames on the
 * same cadence the server used. So the demo keeps looping on slow/no internet,
 * and there is a single producer of demo frames (no reconnect/version races).
 *
 * Mounted once in the play page alongside useWsSession().
 */
export const useDemoFrameLoop = (): void => {
  const demoMode = useVisualizerStore((s) => s.demoMode);
  const demoDeck = useVisualizerStore((s) => s.demoDeck);

  useEffect(() => {
    const store = useVisualizerStore;
    // The frame producer is changing (idle / server live-gen ↔ client demo
    // loop). Reset the monotonic guard so neither side's frames get rejected
    // as stale by pushFrame.
    store.getState().resetFrameVersion();

    if (!demoMode || !demoDeck) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let recent: string[] = [];
    let localVersion = 0;
    let frames: string[] = [];

    const tick = () => {
      if (cancelled) {
        return;
      }
      if (frames.length > 0) {
        let candidates = frames.filter((f) => !recent.includes(f));
        // Mirror the server provider's fallback: if the recent-LRU covers the
        // whole (small) deck, allow the full set so it never stalls.
        if (candidates.length === 0) {
          candidates = frames;
        }
        const url = candidates[
          Math.floor(Math.random() * candidates.length)
        ] as string;
        recent = [url, ...recent.filter((f) => f !== url)].slice(0, LRU);
        const s = store.getState();
        localVersion += 1;
        s.pushFrame(url, localVersion);
        s.pushHero(url);
      }
      const { intensity } = store.getState().scene;
      timer = setTimeout(tick, libraryCadenceMs(intensity, demoDeck));
    };

    void (async () => {
      const f = await loadManifest(demoDeck);
      if (cancelled) {
        return;
      }
      frames = f;
      // fire one frame immediately, then self-schedule
      tick();
    })();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [demoMode, demoDeck]);
};
