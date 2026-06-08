import { useEffect } from "react";

import { useVisualizerStore } from "@/stores/visualizer";

// Replay cadence bounds. "fixed" holds every frame this long; "original" uses
// the per-frame tMs delta, clamped so a long pause in the recorded session
// doesn't stall the replay and a rapid burst doesn't strobe.
const FIXED_CADENCE_MS = 2500;
const MIN_CADENCE_MS = 600;
const MAX_CADENCE_MS = 6000;

/**
 * Client-side reel/session replay. Mirrors useDemoFrameLoop: a single producer
 * that pushes a fixed, ordered frame list onto the same crossfade pipeline
 * (pushFrame → markImageLoaded in the canvas), looping. No server, no fal
 * calls, no audio. Active state + the frame list come from the reel-playback
 * slice (set by ReelPlaybackConsumer). Mounted once in the play page.
 */
export const useReelPlaybackLoop = (): void => {
  const active = useVisualizerStore((s) => s.reelPlaybackActive);
  const frames = useVisualizerStore((s) => s.reelPlaybackFrames);
  const cadence = useVisualizerStore((s) => s.reelPlaybackCadence);

  useEffect(() => {
    const store = useVisualizerStore;
    // Producer is changing — reset the monotonic guard so neither this loop's
    // first frame nor the resuming demo/live producer is rejected as stale.
    store.getState().resetFrameVersion();

    if (!active || frames.length === 0) {
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let idx = 0;
    let localVersion = 0;

    const cadenceFor = (i: number): number => {
      if (cadence === "fixed") {
        return FIXED_CADENCE_MS;
      }
      const cur = frames[i];
      const next = frames[(i + 1) % frames.length];
      if (!(cur && next)) {
        return FIXED_CADENCE_MS;
      }
      const delta = next.tMs - cur.tMs;
      if (delta <= 0) {
        return FIXED_CADENCE_MS;
      }
      return Math.min(MAX_CADENCE_MS, Math.max(MIN_CADENCE_MS, delta));
    };

    const tick = () => {
      if (cancelled) {
        return;
      }
      const frame = frames[idx];
      if (frame) {
        const s = store.getState();
        localVersion += 1;
        s.pushFrame(frame.url, localVersion);
        s.pushHero(frame.url);
      }
      const wait = cadenceFor(idx);
      idx = (idx + 1) % frames.length;
      timer = setTimeout(tick, wait);
    };

    // Fire the first frame immediately, then self-schedule.
    tick();

    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [active, frames, cadence]);
};
