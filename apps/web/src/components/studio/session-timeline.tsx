"use client";

import { useMemo } from "react";
import type { LibraryFrame } from "@sonara/shared";
import { formatDuration, formatMmSs } from "@/lib/format-time";
import { FrameCard } from "./frame-card";

interface SessionTimelineProps {
  frames: LibraryFrame[];
  loading: boolean;
  selectedFrameId: string | null;
  onSelectFrame: (frameId: string) => void;
}

const FRAME_SIZE_DESKTOP = 56;
// Two frames count as "clustered" (and thus stack) when their tMs gap is
// less than this fraction of the total session duration. 1% chosen by
// eye — gives clustering on rapid-burst moments without false-collapsing
// frames a few seconds apart in a 5-minute session.
const CLUSTER_FRACTION = 0.01;

// Time-coded horizontal timeline. Frames are positioned along the
// horizontal axis by their `tMs` proportionally to the session duration.
// Tickmarks underneath at adaptive intervals (every 30s for <5min, every
// 1min for <30min, every 5min for longer). Frames that cluster within
// 1% of total duration stack vertically with the older one beneath.
export function SessionTimeline({
  frames,
  loading,
  selectedFrameId,
  onSelectFrame,
}: SessionTimelineProps) {
  const layout = useMemo(() => computeLayout(frames), [frames]);

  if (loading) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading frames…
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        this session has no frames yet
      </div>
    );
  }

  const maxStack = layout.frames.reduce(
    (m, f) => Math.max(m, f.stackIdx),
    0,
  );
  const trackHeight = FRAME_SIZE_DESKTOP * (maxStack + 1) + maxStack * 4;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10">
      <header className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
          session timeline
        </span>
        <h2 className="font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90">
          {frames.length} frame{frames.length !== 1 ? "s" : ""}
          {" · "}
          {formatDuration(layout.durationMs)}
        </h2>
      </header>

      {/* Timeline track */}
      <div className="relative w-full pb-12">
        <div
          className="relative"
          style={{ height: trackHeight, minHeight: FRAME_SIZE_DESKTOP }}
        >
          {layout.frames.map((entry) => (
            <FrameCard
              key={entry.frame.id}
              frame={entry.frame}
              selected={entry.frame.id === selectedFrameId}
              onSelect={onSelectFrame}
              leftPct={entry.leftPct}
              stackIdx={entry.stackIdx}
              size={FRAME_SIZE_DESKTOP}
            />
          ))}
        </div>

        {/* Tick axis */}
        <div
          className="relative mt-3 h-px w-full bg-[color:var(--hairline)]/40"
          aria-hidden
        >
          {layout.ticks.map((t) => (
            <div
              key={t.ms}
              className="absolute top-0 flex flex-col items-center"
              style={{ left: `${t.pct}%`, transform: "translateX(-50%)" }}
            >
              <span className="block h-2 w-px bg-[color:var(--hairline)]/60" />
              <span className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
                {t.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

interface LayoutEntry {
  frame: LibraryFrame;
  leftPct: number;
  stackIdx: number;
}

interface Layout {
  frames: LayoutEntry[];
  ticks: Array<{ ms: number; pct: number; label: string }>;
  durationMs: number;
}

function computeLayout(frames: LibraryFrame[]): Layout {
  if (frames.length === 0) {
    return { frames: [], ticks: [], durationMs: 0 };
  }
  // Frames arrive ordered by tMs ASC per library.bySession.
  const lastTMs = frames[frames.length - 1]?.tMs ?? 0;
  // Guard: at least 1s of timeline so a single frame still positions.
  const durationMs = Math.max(lastTMs, 1000);

  // Cluster check: if a frame's tMs is within CLUSTER_FRACTION of the
  // previous frame's tMs at the SAME stackIdx, push it one row down.
  const entries: LayoutEntry[] = [];
  const lastAtStack: number[] = []; // index = stackIdx, value = last tMs at that row
  const clusterWindowMs = durationMs * CLUSTER_FRACTION;

  for (const f of frames) {
    let stackIdx = 0;
    while (
      lastAtStack[stackIdx] !== undefined &&
      f.tMs - (lastAtStack[stackIdx] ?? 0) < clusterWindowMs
    ) {
      stackIdx++;
    }
    lastAtStack[stackIdx] = f.tMs;
    const leftPct = (f.tMs / durationMs) * 100;
    entries.push({ frame: f, leftPct, stackIdx });
  }

  const ticks = computeTicks(durationMs);
  return { frames: entries, ticks, durationMs };
}

function computeTicks(
  durationMs: number,
): Array<{ ms: number; pct: number; label: string }> {
  // Adaptive interval: every 30s up to 5min, every 1min up to 30min,
  // every 5min beyond.
  const minutes = durationMs / 60_000;
  const intervalMs =
    minutes < 5
      ? 30_000
      : minutes < 30
        ? 60_000
        : 5 * 60_000;
  const ticks: Array<{ ms: number; pct: number; label: string }> = [];
  for (let ms = 0; ms <= durationMs; ms += intervalMs) {
    ticks.push({
      ms,
      pct: (ms / durationMs) * 100,
      label: formatMmSs(ms),
    });
  }
  return ticks;
}

