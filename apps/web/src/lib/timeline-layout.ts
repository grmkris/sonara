import type { LibraryFrame } from "@sonara/shared";

// Pure timeline layout: lay frames left-to-right, each clip's width = its hold
// duration (authored durationMs, else the set's nominal). Shared by the
// timeline track (clip widths + ruler) and the playback clock
// (use-timeline-playback) so the drawn widths and the played timing never
// diverge. `startMs` is the running offset; `totalMs` is the full length.

export interface TimelineEntry {
  frame: LibraryFrame;
  startMs: number;
  ms: number;
}

export interface TimelineLayout {
  entries: TimelineEntry[];
  totalMs: number;
}

export const holdMs = (frame: LibraryFrame, nominalMs: number): number =>
  typeof frame.durationMs === "number" ? frame.durationMs : nominalMs;

export const computeTimelineLayout = (
  frames: LibraryFrame[],
  nominalMs: number
): TimelineLayout => {
  let acc = 0;
  const entries = frames.map((frame) => {
    const ms = holdMs(frame, nominalMs);
    const startMs = acc;
    acc += ms;
    return { frame, ms, startMs };
  });
  return { entries, totalMs: acc };
};

// The index of the clip whose [startMs, startMs+ms) contains `ms` (clamped to
// the last clip at/after the end).
export const indexAtMs = (layout: TimelineLayout, ms: number): number => {
  const { entries } = layout;
  if (entries.length === 0) {
    return -1;
  }
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (ms >= (entries[i] as TimelineEntry).startMs) {
      return i;
    }
  }
  return 0;
};
