"use client";

import type { FrameSet, FrameSetVisibility, LibraryFrame } from "@sonara/shared";
import { Play, Scissors } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef } from "react";

import { useGridCursor } from "@/hooks/use-grid-cursor";
import { useMarqueeSelection } from "@/hooks/use-marquee-selection";
import { useTileRegistry } from "@/hooks/use-tile-registry";
import { formatDuration, formatMmSs } from "@/lib/format-time";

import type { FrameDragPayload } from "@/lib/curation-dnd";

import { FrameCard } from "./frame-card";
import { SelectModeToggle } from "./select-mode-toggle";
import type { TileClickMods } from "./set-frame-tile";
import { SetShareControls } from "./set-share-controls";

interface RecordingTimelineProps {
  recording: FrameSet | null;
  loading: boolean;
  selectedFrameId: string | null;
  onMakeCut: () => void;
  onVisibilityChange: (visibility: FrameSetVisibility) => void;
  // Selection v2 (page-owned): the page resolves the click matrix.
  onFrameClick: (frameId: string, mods: TileClickMods) => void;
  onFrameOpen: (frameId: string) => void;
  onFrameCheck: (frameId: string) => void;
  isSelected: (frameId: string) => boolean;
  isSelecting: boolean;
  pinned: boolean;
  onTogglePinned: () => void;
  onMarquee: (ids: string[], additive: boolean) => void;
  onWhitespaceClick: () => void;
  marqueeEnabled?: boolean;
  // Drag frames OUT of the recording (toward sidebar sets / the open set).
  getDragPayload?: (frameId: string) => FrameDragPayload;
  selectionApi: {
    toggle: (id: string) => void;
    rangeTo: (id: string) => void;
    selectedFrameIds: string[];
  };
}

const FRAME_SIZE_DESKTOP = 56;
// Two frames count as "clustered" (and thus stack) when their tMs gap is
// less than this fraction of the total recording duration. 1% chosen by
// eye — gives clustering on rapid-burst moments without false-collapsing
// frames a few seconds apart in a 5-minute recording.
const CLUSTER_FRACTION = 0.01;

interface LayoutEntry {
  frame: LibraryFrame;
  leftPct: number;
  stackIdx: number;
}

interface Layout {
  frames: LayoutEntry[];
  ticks: { ms: number; pct: number; label: string }[];
  durationMs: number;
}

const computeTicks = (
  durationMs: number
): { ms: number; pct: number; label: string }[] => {
  // Adaptive interval: every 30s up to 5min, every 1min up to 30min,
  // every 5min beyond.
  const minutes = durationMs / 60_000;
  let intervalMs = 5 * 60_000;
  if (minutes < 5) {
    intervalMs = 30_000;
  } else if (minutes < 30) {
    intervalMs = 60_000;
  }
  const ticks: { ms: number; pct: number; label: string }[] = [];
  for (let ms = 0; ms <= durationMs; ms += intervalMs) {
    ticks.push({
      label: formatMmSs(ms),
      ms,
      pct: (ms / durationMs) * 100,
    });
  }
  return ticks;
};

const computeLayout = (frames: LibraryFrame[]): Layout => {
  if (frames.length === 0) {
    return { durationMs: 0, frames: [], ticks: [] };
  }
  // Frames arrive ordered by tMs ASC per sets.get (junction position order).
  const lastTMs = frames.at(-1)?.tMs ?? 0;
  // Guard: at least 1s of timeline so a single frame still positions.
  const durationMs = Math.max(lastTMs, 1000);

  // Cluster check: if a frame's tMs is within CLUSTER_FRACTION of the
  // previous frame's tMs at the SAME stackIdx, push it one row down.
  const entries: LayoutEntry[] = [];
  // index = stackIdx, value = last tMs at that row
  const lastAtStack: number[] = [];
  const clusterWindowMs = durationMs * CLUSTER_FRACTION;

  for (const f of frames) {
    let stackIdx = 0;
    while (
      lastAtStack[stackIdx] !== undefined &&
      f.tMs - (lastAtStack[stackIdx] ?? 0) < clusterWindowMs
    ) {
      stackIdx += 1;
    }
    lastAtStack[stackIdx] = f.tMs;
    const leftPct = (f.tMs / durationMs) * 100;
    entries.push({ frame: f, leftPct, stackIdx });
  }

  const ticks = computeTicks(durationMs);
  return { durationMs, frames: entries, ticks };
};

// Time-coded horizontal timeline for a recording set. Frames are positioned
// along the horizontal axis by their `tMs` proportionally to the recording
// duration. Tickmarks underneath at adaptive intervals (every 30s for <5min,
// every 1min for <30min, every 5min for longer). Frames that cluster within
// 1% of total duration stack vertically with the older one beneath. A
// recording's frame list is frozen — "make a cut" derives an editable set.
export const RecordingTimeline = ({
  recording,
  loading,
  selectedFrameId,
  onMakeCut,
  onVisibilityChange,
  onFrameClick,
  onFrameOpen,
  onFrameCheck,
  isSelected,
  isSelecting,
  pinned,
  onTogglePinned,
  onMarquee,
  onWhitespaceClick,
  marqueeEnabled = true,
  getDragPayload,
  selectionApi,
}: RecordingTimelineProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { measure, registerTile } = useTileRegistry();
  const { marqueeProps, marqueeRect } = useMarqueeSelection({
    containerRef,
    enabled: marqueeEnabled,
    measureItems: () =>
      containerRef.current ? measure(containerRef.current) : [],
    onChange: onMarquee,
    onWhitespaceClick,
  });
  const cursor = useGridCursor({
    displayOrder: (recording?.frames ?? []).map((f) => f.id as string),
    focusTile: (id) => {
      const el = containerRef.current?.querySelector(
        `[data-frame-tile="${id}"] button`
      );
      (el as HTMLElement | null)?.focus();
    },
    measure: () =>
      containerRef.current ? measure(containerRef.current) : [],
    onOpen: onFrameOpen,
    selection: selectionApi,
  });
  const frames = recording?.frames ?? [];
  const layout = useMemo(
    () => computeLayout(recording?.frames ?? []),
    [recording]
  );

  if (loading || !recording) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        loading frames…
      </div>
    );
  }

  if (frames.length === 0) {
    return (
      <div className="px-10 py-16 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)]">
        this recording has no frames yet
      </div>
    );
  }

  let maxStack = 0;
  for (const f of layout.frames) {
    maxStack = Math.max(maxStack, f.stackIdx);
  }
  const trackHeight = FRAME_SIZE_DESKTOP * (maxStack + 1) + maxStack * 4;

  return (
    <div
      ref={containerRef}
      {...marqueeProps}
      onKeyDown={cursor.onKeyDown}
      className="relative flex h-full flex-col gap-6 overflow-y-auto px-6 py-8 md:px-10"
    >
      {marqueeRect && (
        <div
          aria-hidden
          className="pointer-events-none absolute z-20 border border-[color:var(--paper)]/50 bg-[color:var(--paper)]/8"
          style={{
            height: marqueeRect.h,
            left: marqueeRect.x,
            top: marqueeRect.y,
            width: marqueeRect.w,
          }}
        />
      )}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.26em] text-[color:var(--stone)]">
            recording
          </span>
          <h2 className="truncate font-sans text-[14px] uppercase tracking-[0.18em] text-[color:var(--paper)]/90">
            {recording.name}
          </h2>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
            {frames.length} frame{frames.length === 1 ? "" : "s"}
            {" · "}
            {formatDuration(layout.durationMs)}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          <SetShareControls
            setId={recording.id}
            visibility={recording.visibility}
            onVisibilityChange={onVisibilityChange}
          />
          <SelectModeToggle active={pinned} onToggle={onTogglePinned} />
          <button
            type="button"
            onClick={onMakeCut}
            className="focus-ring font-sans inline-flex items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
          >
            <Scissors className="size-3" strokeWidth={1.5} />
            make a cut
          </button>
          <Link
            href={`/play?set=${encodeURIComponent(recording.id)}`}
            className="focus-ring font-sans inline-flex shrink-0 items-center gap-1.5 border border-[color:var(--hairline)]/40 px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
          >
            <Play className="size-3" strokeWidth={1.5} />
            replay
          </Link>
        </div>
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
              onClick={onFrameClick}
              onOpen={onFrameOpen}
              onCheck={onFrameCheck}
              checked={isSelected(entry.frame.id)}
              selecting={isSelecting}
              registerRef={registerTile(entry.frame.id)}
              tabIndex={cursor.tileTabIndex(entry.frame.id)}
              onFocusTile={cursor.onTileFocus}
              getDragPayload={
                getDragPayload
                  ? () => getDragPayload(entry.frame.id)
                  : undefined
              }
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
};
