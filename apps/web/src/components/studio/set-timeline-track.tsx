"use client";

import { autoScrollForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { LibraryFrame } from "@sonara/shared";
import type { ImageLibraryId } from "@sonara/shared/typeid";
import { Magnet, Maximize2, Minus, Plus } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import { useGridCursor } from "@/hooks/use-grid-cursor";
import { useMarqueeSelection } from "@/hooks/use-marquee-selection";
import { useTileRegistry } from "@/hooks/use-tile-registry";
import { isFramePayload } from "@/lib/curation-dnd";
import type { FrameDragPayload } from "@/lib/curation-dnd";
import { formatMmSs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

import type { TileClickMods } from "./set-frame-tile";
import { TimelineClip } from "./timeline-clip";

const TRACK_HEIGHT = 72;
const RULER_HEIGHT = 22;
const MIN_PPS = 2;
const MAX_PPS = 240;
const DEFAULT_PPS = 32;
const TICK_TARGET_PX = 72;
// Hold durations climb on a roughly-logarithmic feel; a "nice" ladder keeps
// ruler labels legible at any zoom.
const NICE_TICK_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

interface SetTimelineTrackProps {
  frames: LibraryFrame[];
  setId: string;
  // Display fallback for un-pinned frames (the set's calm look-cadence, or an
  // app default) — their real replay timing is reactive, so the timeline shows
  // a representative width.
  nominalMs: number;
  coverFrameId: ImageLibraryId | null;
  selectedFrameId: string | null;
  onFrameClick: (frameId: string, mods: TileClickMods) => void;
  onFrameOpen: (frameId: string) => void;
  onFrameCheck: (frameId: string) => void;
  isSelected: (frameId: string) => boolean;
  isSelecting: boolean;
  onMarquee: (ids: string[], additive: boolean) => void;
  onWhitespaceClick: () => void;
  marqueeEnabled: boolean;
  selectionApi: {
    toggle: (id: string) => void;
    rangeTo: (id: string) => void;
    selectedFrameIds: string[];
  };
  // Edit affordances — present only when the set is editable.
  getDragPayload?: (frameId: string) => FrameDragPayload;
  onRemoveFrame?: (frameId: string) => void;
  onRemoveFrames?: (ids: string[]) => void;
  onSetCover?: (frameId: string) => void;
  onMoveFrame?: (frameId: string, dir: "prev" | "next") => void;
  // Pin/clear a frame's authored hold duration (null clears → reactive).
  onSetFrameDuration?: (frameId: string, durationMs: number | null) => void;
}

const ZoomButton = ({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    aria-pressed={active}
    title={label}
    className={cn(
      "focus-ring inline-flex items-center justify-center border border-[color:var(--hairline)]/40 p-1.5 text-[color:var(--paper)]/85 transition-colors hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]",
      active && "border-[color:var(--paper)]/70 text-[color:var(--paper)]"
    )}
  >
    {children}
  </button>
);

// The editable timeline surface for a curated set: a horizontal filmstrip where
// each clip's width is its hold duration. Owns its own scroll surface (so the
// page-owned marquee/cursor/registry measure against the right element), the
// zoom + snap toolbar, the time ruler, and a scrub playhead. Reorder + drop are
// the shared studio DnD (clips emit the same closest-edge payload as the grid).
export const SetTimelineTrack = ({
  frames,
  setId,
  nominalMs,
  coverFrameId,
  selectedFrameId,
  onFrameClick,
  onFrameOpen,
  onFrameCheck,
  isSelected,
  isSelecting,
  onMarquee,
  onWhitespaceClick,
  marqueeEnabled,
  selectionApi,
  getDragPayload,
  onRemoveFrame,
  onRemoveFrames,
  onSetCover,
  onMoveFrame,
  onSetFrameDuration,
}: SetTimelineTrackProps) => {
  const editable = !!onSetFrameDuration;
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);

  const [pps, setPps] = useState(DEFAULT_PPS);
  const [snap, setSnap] = useState(true);
  const [playheadMs, setPlayheadMs] = useState(0);
  // Live trim preview — reflows the whole track while a handle is dragged;
  // cleared on commit (the RPC result re-reads from the source of truth).
  const [trimPreview, setTrimPreview] = useState<{
    frameId: string;
    durationMs: number;
  } | null>(null);

  const { measure, registerTile } = useTileRegistry();
  const { marqueeProps, marqueeRect } = useMarqueeSelection({
    containerRef: scrollRef,
    enabled: marqueeEnabled,
    measureItems: () => (scrollRef.current ? measure(scrollRef.current) : []),
    onChange: onMarquee,
    onWhitespaceClick,
  });
  const cursor = useGridCursor({
    displayOrder: frames.map((f) => f.id as string),
    focusTile: (id) => {
      const el = scrollRef.current?.querySelector(
        `[data-frame-tile="${id}"] button`
      );
      (el as HTMLElement | null)?.focus();
    },
    measure: () => (scrollRef.current ? measure(scrollRef.current) : []),
    onMove: onMoveFrame,
    onOpen: onFrameOpen,
    onRemove: onRemoveFrames,
    selection: selectionApi,
  });

  // Effective display duration per frame (live preview wins, then the pin,
  // then the nominal), with running start offsets for ruler/playhead math.
  const layout = useMemo(() => {
    let acc = 0;
    const entries = frames.map((frame) => {
      const ms =
        trimPreview?.frameId === frame.id
          ? trimPreview.durationMs
          : (frame.durationMs ?? nominalMs);
      const startMs = acc;
      acc += ms;
      return { frame, ms, startMs };
    });
    return { entries, totalMs: acc };
  }, [frames, nominalMs, trimPreview]);

  const totalWidthPx = (layout.totalMs / 1000) * pps;

  const ticks = useMemo(() => {
    // Seconds covered by the ~72px target gap, snapped up to a "nice" step.
    const target = TICK_TARGET_PX / pps;
    const stepS =
      NICE_TICK_S.find((s) => s >= target) ?? NICE_TICK_S.at(-1) ?? 60;
    const stepMs = stepS * 1000;
    const out: { ms: number; label: string }[] = [];
    for (let ms = 0; ms <= layout.totalMs; ms += stepMs) {
      out.push({ label: formatMmSs(ms), ms });
    }
    return out;
  }, [pps, layout.totalMs]);

  // set-grid drop target (append / reorder fallback) + edge auto-scroll while a
  // frame drag is in flight — same contract the grid editor used.
  const droppable = !!getDragPayload;
  useEffect(() => {
    const scroll = scrollRef.current;
    const row = rowRef.current;
    if (!(scroll && row && droppable)) {
      return;
    }
    return combine(
      autoScrollForElements({
        canScroll: ({ source }) => isFramePayload(source.data),
        element: scroll,
      }),
      dropTargetForElements({
        canDrop: ({ source }) => isFramePayload(source.data),
        element: row,
        getData: () => ({ kind: "set-grid", setId }),
      })
    );
  }, [droppable, setId]);

  const zoomBy = useCallback((factor: number) => {
    setPps((p) => Math.max(MIN_PPS, Math.min(MAX_PPS, p * factor)));
  }, []);

  const fitToWindow = useCallback(() => {
    const w = scrollRef.current?.clientWidth ?? 0;
    const seconds = layout.totalMs / 1000;
    if (w > 0 && seconds > 0) {
      setPps(Math.max(MIN_PPS, Math.min(MAX_PPS, (w - 32) / seconds)));
    }
  }, [layout.totalMs]);

  const msAtClientX = useCallback(
    (clientX: number): number => {
      const left = contentRef.current?.getBoundingClientRect().left ?? 0;
      const ms = ((clientX - left) / pps) * 1000;
      return Math.max(0, Math.min(layout.totalMs, ms));
    },
    [pps, layout.totalMs]
  );

  const playheadDragRef = useRef(false);
  const onPlayheadDown = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    playheadDragRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPlayheadMove = (e: ReactPointerEvent) => {
    if (playheadDragRef.current) {
      setPlayheadMs(msAtClientX(e.clientX));
    }
  };
  const onPlayheadUp = (e: ReactPointerEvent) => {
    if (playheadDragRef.current) {
      playheadDragRef.current = false;
      e.currentTarget.releasePointerCapture?.(e.pointerId);
    }
  };

  // 'n' toggles snapping (an NLE convention) without stealing keys from the
  // shared cursor; everything else falls through to it.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const typing =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.isContentEditable;
    if (!typing && (e.key === "n" || e.key === "N") && !(e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      setSnap((s) => !s);
      return;
    }
    cursor.onKeyDown(e);
  };

  const playheadX = (playheadMs / 1000) * pps;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Zoom + snap toolbar */}
      <div className="flex shrink-0 items-center gap-2 pb-3">
        <ZoomButton label="zoom out" onClick={() => zoomBy(1 / 1.4)}>
          <Minus className="size-3.5" strokeWidth={1.5} />
        </ZoomButton>
        <ZoomButton label="zoom in" onClick={() => zoomBy(1.4)}>
          <Plus className="size-3.5" strokeWidth={1.5} />
        </ZoomButton>
        <ZoomButton label="fit to window" onClick={fitToWindow}>
          <Maximize2 className="size-3.5" strokeWidth={1.5} />
        </ZoomButton>
        {editable && (
          <ZoomButton
            label="toggle snapping (n)"
            onClick={() => setSnap((s) => !s)}
            active={snap}
          >
            <Magnet className="size-3.5" strokeWidth={1.5} />
          </ZoomButton>
        )}
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--stone)]">
          {formatMmSs(layout.totalMs)}
        </span>
      </div>

      {/* Scroll surface (both axes) — marquee + cursor measure against this. */}
      <div
        ref={scrollRef}
        {...marqueeProps}
        onKeyDown={onKeyDown}
        className="relative min-h-0 flex-1 overflow-auto"
      >
        {marqueeRect && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-30 border border-[color:var(--paper)]/50 bg-[color:var(--paper)]/8"
            style={{
              height: marqueeRect.h,
              left: marqueeRect.x,
              top: marqueeRect.y,
              width: marqueeRect.w,
            }}
          />
        )}
        <div
          ref={contentRef}
          className="relative"
          style={{ width: Math.max(totalWidthPx, 1) }}
        >
          {/* Ruler — click to seek */}
          <button
            type="button"
            aria-label="seek"
            onClick={(e) => setPlayheadMs(msAtClientX(e.clientX))}
            className="relative block w-full cursor-text"
            style={{ height: RULER_HEIGHT }}
          >
            <span
              aria-hidden
              className="absolute bottom-0 left-0 h-px w-full bg-[color:var(--hairline)]/40"
            />
            {ticks.map((t) => (
              <span
                key={t.ms}
                aria-hidden
                className="absolute bottom-0 flex flex-col items-start"
                style={{ left: (t.ms / 1000) * pps }}
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-[color:var(--stone)]">
                  {t.label}
                </span>
                <span className="block h-1.5 w-px bg-[color:var(--hairline)]/60" />
              </span>
            ))}
          </button>

          {/* Clip row */}
          <div ref={rowRef} className="flex" style={{ height: TRACK_HEIGHT }}>
            {layout.entries.map(({ frame, ms }, i) => (
              <TimelineClip
                key={frame.id}
                frame={frame}
                index={i}
                widthPx={Math.max((ms / 1000) * pps, 6)}
                heightPx={TRACK_HEIGHT}
                durationMs={ms}
                pinned={typeof frame.durationMs === "number"}
                pps={pps}
                selected={frame.id === selectedFrameId}
                isCover={coverFrameId ? frame.id === coverFrameId : false}
                checked={isSelected(frame.id)}
                selecting={isSelecting}
                onClick={onFrameClick}
                onOpen={onFrameOpen}
                onCheck={onFrameCheck}
                registerRef={registerTile(frame.id)}
                tabIndex={cursor.tileTabIndex(frame.id)}
                onFocusTile={cursor.onTileFocus}
                dnd={
                  getDragPayload
                    ? { getPayload: () => getDragPayload(frame.id), setId }
                    : undefined
                }
                onRemove={onRemoveFrame}
                onSetCover={onSetCover}
                onTrimPreview={
                  editable
                    ? (id, durationMs) => setTrimPreview({ durationMs, frameId: id })
                    : undefined
                }
                onTrimCommit={
                  onSetFrameDuration
                    ? (id, durationMs) => {
                        setTrimPreview(null);
                        onSetFrameDuration(id, durationMs);
                      }
                    : undefined
                }
                onResetDuration={
                  onSetFrameDuration
                    ? (id) => onSetFrameDuration(id, null)
                    : undefined
                }
                snap={snap}
              />
            ))}
          </div>

          {/* Playhead — line spans ruler + clips; head is grabbable. */}
          <div
            className="pointer-events-none absolute top-0 z-20"
            style={{
              height: RULER_HEIGHT + TRACK_HEIGHT,
              transform: `translateX(${playheadX}px)`,
            }}
          >
            <div className="relative h-full">
              <span className="absolute left-0 top-0 h-full w-px bg-[color:var(--signal)]" />
              <span
                role="presentation"
                aria-hidden
                onPointerDown={onPlayheadDown}
                onPointerMove={onPlayheadMove}
                onPointerUp={onPlayheadUp}
                onPointerCancel={onPlayheadUp}
                className="pointer-events-auto absolute -left-1.5 top-0 h-3 w-3 cursor-ew-resize bg-[color:var(--signal)]"
                style={{ clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
