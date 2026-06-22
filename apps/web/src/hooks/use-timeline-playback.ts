"use client";

import type { LibraryFrame } from "@sonara/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { computeTimelineLayout, indexAtMs } from "@/lib/timeline-layout";
import { useVisualizerStore } from "@/stores/visualizer";

// The timeline IS the clock. When the preview is open (`active`), this drives
// the embedded visualizer by pushing the frame under the playhead straight
// into the visualizer store (the same producer pattern as use-playback-loop's
// ordered branch — pushFrame + a monotonic version), and while `playing` it
// steps the playhead clip-to-clip on each clip's hold. `seekTo` moves the
// playhead and shows that frame immediately, so dragging the playhead / the
// ruler scrubs the preview. No `setSource` is issued, so nothing bleeds into
// /play. WYSIWYG: frames swap at the drawn clip widths.

export interface TimelinePlayback {
  playheadMs: number;
  currentFrameId: string | null;
  seekTo: (ms: number) => void;
  totalMs: number;
}

const MIN_HOLD_MS = 50;

export const useTimelinePlayback = (opts: {
  frames: LibraryFrame[];
  nominalMs: number;
  active: boolean;
  playing: boolean;
}): TimelinePlayback => {
  const { frames, nominalMs, active, playing } = opts;
  const layout = useMemo(
    () => computeTimelineLayout(frames, nominalMs),
    [frames, nominalMs]
  );

  const [playheadMs, setPlayheadMsState] = useState(0);
  const [currentFrameId, setCurrentFrameId] = useState<string | null>(null);
  // Bumped on every seek so the clock restarts from the new position (its
  // internal index is otherwise independent and would snap the playhead back).
  const [seekNonce, setSeekNonce] = useState(0);
  // Mirror the playhead in a ref so the clock can read the latest position
  // without re-subscribing (and so a resumed clock starts where you paused).
  const playheadMsRef = useRef(0);
  const versionRef = useRef(0);

  const setPlayhead = useCallback((ms: number) => {
    playheadMsRef.current = ms;
    setPlayheadMsState(ms);
  }, []);

  const pushIndex = useCallback(
    (i: number) => {
      const entry = layout.entries[i];
      if (!entry) {
        return;
      }
      versionRef.current += 1;
      const s = useVisualizerStore.getState();
      s.pushFrame(entry.frame.url, versionRef.current);
      s.pushHero(entry.frame.url);
      setCurrentFrameId(entry.frame.id as string);
    },
    [layout]
  );

  const seekTo = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(layout.totalMs, ms));
      setPlayhead(clamped);
      setSeekNonce((n) => n + 1);
      // Only drive the canvas when the preview is open; otherwise the playhead
      // is just a marker on the timeline.
      if (active) {
        const i = indexAtMs(layout, clamped);
        if (i >= 0) {
          pushIndex(i);
        }
      }
    },
    [active, layout, pushIndex, setPlayhead]
  );

  // Reset the monotonic frame guard whenever the producer (re)activates, so the
  // first push isn't rejected as stale by pushFrame.
  useEffect(() => {
    if (active) {
      versionRef.current = 0;
      useVisualizerStore.getState().resetFrameVersion();
    }
  }, [active]);

  // Producer: while paused, show the frame under the playhead; while playing,
  // step the playhead clip-to-clip on each hold (setTimeout chain, like
  // use-playback-loop). Re-runs when the layout changes (an edit) so the
  // preview follows reorder/trim/remove.
  useEffect(() => {
    if (!active || layout.entries.length === 0) {
      return;
    }
    if (!playing) {
      const i = indexAtMs(layout, playheadMsRef.current);
      if (i >= 0) {
        pushIndex(i);
      }
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let i = Math.max(0, indexAtMs(layout, playheadMsRef.current));
    const tick = () => {
      if (cancelled) {
        return;
      }
      const entry = layout.entries[i];
      if (!entry) {
        return;
      }
      setPlayhead(entry.startMs);
      pushIndex(i);
      const wait = Math.max(MIN_HOLD_MS, entry.ms);
      i = (i + 1) % layout.entries.length;
      timer = setTimeout(tick, wait);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
    // seekNonce: restart the clock from the new playhead after a seek.
  }, [active, playing, layout, pushIndex, setPlayhead, seekNonce]);

  return { currentFrameId, playheadMs, seekTo, totalMs: layout.totalMs };
};
