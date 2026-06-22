"use client";

import {
  attachClosestEdge,
  extractClosestEdge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/types";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { pointerOutsideOfPreview } from "@atlaskit/pragmatic-drag-and-drop/element/pointer-outside-of-preview";
import { setCustomNativeDragPreview } from "@atlaskit/pragmatic-drag-and-drop/element/set-custom-native-drag-preview";
import { clampFrameDurationMs } from "@sonara/shared";
import type { LibraryFrame } from "@sonara/shared";
import { ImageIcon, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { createRoot } from "react-dom/client";

import { FrameDragPreview } from "@/components/studio/drag-preview";
import { DropEdgeIndicator } from "@/components/studio/drop-indicator";
import { TileCheck } from "@/components/studio/tile-check";
import { useLongPress } from "@/hooks/use-long-press";
import { isFramePayload } from "@/lib/curation-dnd";
import type { FrameDragPayload } from "@/lib/curation-dnd";
import { cn } from "@/lib/utils";

import type { TileClickMods } from "./set-frame-tile";

// Trim snaps to this grid (ms) unless snapping is off — a clean, honest
// equivalent of neighbour-edge snapping on a ripple single-track (where each
// clip's start is just the running sum, so a duration that lands on a round
// grid keeps the whole track readable).
const SNAP_MS = 250;

const formatSeconds = (ms: number): string => {
  const s = ms / 1000;
  return `${s % 1 === 0 ? s.toFixed(0) : s.toFixed(1)}s`;
};

interface TimelineClipProps {
  frame: LibraryFrame;
  index: number;
  // Display width in px (already reflects any live trim preview from the host).
  widthPx: number;
  heightPx: number;
  // Effective display duration (pinned value, else the set's nominal hold).
  durationMs: number;
  // Whether this frame carries an authored durationMs pin.
  pinned: boolean;
  // Pixels per second — converts a trim's px delta into a duration delta.
  pps: number;
  selected: boolean;
  isCover: boolean;
  checked: boolean;
  selecting: boolean;
  onClick: (frameId: string, mods: TileClickMods) => void;
  onOpen: (frameId: string) => void;
  onCheck: (frameId: string) => void;
  registerRef?: (el: HTMLElement | null) => void;
  tabIndex?: 0 | -1;
  onFocusTile?: (frameId: string) => void;
  // Drag-and-drop — present only when the set is editable (gates the handles
  // and the drop target). Same closest-edge payload as the grid tile, so the
  // shared studio drop monitor reorders timeline clips with no extra wiring.
  dnd?: {
    setId: string;
    getPayload: () => FrameDragPayload;
  };
  onRemove?: (frameId: string) => void;
  onSetCover?: (frameId: string) => void;
  // Trim — present only when editable. Preview fires continuously during the
  // drag (host reflows the track); commit fires once on release (RPC).
  onTrimPreview?: (frameId: string, durationMs: number) => void;
  onTrimCommit?: (frameId: string, durationMs: number) => void;
  // Clear the pin → frame reverts to the set's reactive look-cadence.
  onResetDuration?: (frameId: string) => void;
  snap: boolean;
}

const TrimHandle = ({
  side,
  onResize,
  onResizeEnd,
}: {
  side: "left" | "right";
  onResize: (clientX: number, side: "left" | "right") => void;
  onResizeEnd: (clientX: number, side: "left" | "right") => void;
}) => {
  const draggingRef = useRef(false);

  const onPointerDown = (e: ReactPointerEvent) => {
    // Block the wrapper's native drag from starting, and keep the gesture even
    // if the pointer leaves the thin handle.
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    if (draggingRef.current) {
      onResize(e.clientX, side);
    }
  };
  const end = (e: ReactPointerEvent) => {
    if (!draggingRef.current) {
      return;
    }
    draggingRef.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    onResizeEnd(e.clientX, side);
  };

  return (
    <div
      // Wide invisible hit area, thin visible bar — the production convention
      // (hit target ≫ the line you see).
      className={cn(
        "absolute inset-y-0 z-20 flex w-3 cursor-ew-resize items-stretch opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
        side === "left" ? "left-0 justify-start" : "right-0 justify-end"
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDragStart={(e) => e.preventDefault()}
      role="presentation"
      aria-hidden
    >
      <span className="w-0.5 bg-[color:var(--paper)]/80" />
    </div>
  );
};

// One frame as a clip on the set timeline: a variable-width tile whose width is
// its hold duration. Shares the grid tile's selection/drag gestures (so the
// page-owned selection + drop monitor are reused verbatim) and adds edge trim
// handles that pin the frame's duration (raw pointer — HTML5 DnD can't resize).
export const TimelineClip = ({
  frame,
  index,
  widthPx,
  heightPx,
  durationMs,
  pinned,
  pps,
  selected,
  isCover,
  checked,
  selecting,
  onClick,
  onOpen,
  onCheck,
  registerRef,
  tabIndex,
  onFocusTile,
  dnd,
  onRemove,
  onSetCover,
  onTrimPreview,
  onTrimCommit,
  onResetDuration,
  snap,
}: TimelineClipProps) => {
  const editable = !!onTrimCommit;
  const longPress = useLongPress(() => onCheck(frame.id));
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [dropEdge, setDropEdge] = useState<Edge | null>(null);
  const [dragging, setDragging] = useState(false);

  // The duration the trim started from — captured on the first move so the px
  // delta maps onto a stable base regardless of intermediate reflows.
  const trimBaseRef = useRef<number | null>(null);
  const trimStartXRef = useRef(0);

  const setRefs = useCallback(
    (el: HTMLDivElement | null) => {
      wrapperRef.current = el;
      registerRef?.(el);
    },
    [registerRef]
  );

  const dndSetId = dnd?.setId;
  const getPayloadRef = useRef(dnd?.getPayload);
  getPayloadRef.current = dnd?.getPayload;

  useEffect(() => {
    const el = wrapperRef.current;
    if (!(el && dndSetId)) {
      return;
    }
    return combine(
      draggable({
        element: el,
        getInitialData: () =>
          (getPayloadRef.current?.() ?? {}) as unknown as Record<
            string,
            unknown
          >,
        onDragStart: () => setDragging(true),
        onDrop: () => setDragging(false),
        onGenerateDragPreview: ({ nativeSetDragImage, source }) => {
          const payload = source.data;
          if (!isFramePayload(payload)) {
            return;
          }
          setCustomNativeDragPreview({
            getOffset: pointerOutsideOfPreview({ x: "12px", y: "12px" }),
            nativeSetDragImage,
            render({ container }) {
              const root = createRoot(container);
              root.render(
                <FrameDragPreview
                  count={payload.frameIds.length}
                  urls={payload.previewUrls}
                />
              );
              return () => root.unmount();
            },
          });
        },
      }),
      dropTargetForElements({
        canDrop: ({ source }) => isFramePayload(source.data),
        element: el,
        getData: ({ element, input }) =>
          attachClosestEdge(
            { frameId: frame.id, index, kind: "set-tile", setId: dndSetId },
            { allowedEdges: ["left", "right"], element, input }
          ),
        onDrag: ({ self, source }) => {
          if (
            isFramePayload(source.data) &&
            source.data.frameIds.includes(frame.id)
          ) {
            setDropEdge(null);
            return;
          }
          setDropEdge(extractClosestEdge(self.data));
        },
        onDragLeave: () => setDropEdge(null),
        onDrop: () => setDropEdge(null),
      })
    );
  }, [dndSetId, frame.id, index]);

  // px delta on the dragged edge → a clamped, optionally-snapped duration.
  const resolveDuration = useCallback(
    (clientX: number, side: "left" | "right"): number => {
      const base = trimBaseRef.current ?? durationMs;
      const dx = clientX - trimStartXRef.current;
      // Left edge: dragging left (dx<0) lengthens; right edge: dragging right
      // lengthens. Both edges just resize on a ripple track.
      const deltaMs = ((side === "right" ? dx : -dx) / pps) * 1000;
      let next = base + deltaMs;
      if (snap) {
        next = Math.round(next / SNAP_MS) * SNAP_MS;
      }
      return clampFrameDurationMs(next);
    },
    [durationMs, pps, snap]
  );

  const onResize = useCallback(
    (clientX: number, side: "left" | "right") => {
      if (trimBaseRef.current === null) {
        trimBaseRef.current = durationMs;
        trimStartXRef.current = clientX;
        return;
      }
      onTrimPreview?.(frame.id, resolveDuration(clientX, side));
    },
    [durationMs, frame.id, onTrimPreview, resolveDuration]
  );

  const onResizeEnd = useCallback(
    (clientX: number, side: "left" | "right") => {
      if (trimBaseRef.current === null) {
        return;
      }
      const next = resolveDuration(clientX, side);
      trimBaseRef.current = null;
      onTrimCommit?.(frame.id, next);
    },
    [frame.id, onTrimCommit, resolveDuration]
  );

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (longPress.consumeFired()) {
      return;
    }
    onClick(frame.id, {
      metaOrCtrl: e.metaKey || e.ctrlKey,
      shiftKey: e.shiftKey,
    });
  };

  let stateClass =
    "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/70";
  if (checked) {
    stateClass =
      "border-[color:var(--signal)] ring-2 ring-[color:var(--signal)]";
  } else if (selected) {
    stateClass = "border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40";
  }

  return (
    <div
      className={cn("group relative shrink-0", dragging && "opacity-40")}
      data-frame-tile={frame.id}
      ref={setRefs}
      style={{ width: widthPx }}
    >
      {dropEdge && (
        <DropEdgeIndicator edge={dropEdge === "left" ? "left" : "right"} />
      )}
      <button
        type="button"
        tabIndex={tabIndex}
        onFocus={onFocusTile ? () => onFocusTile(frame.id) : undefined}
        onClick={handleClick}
        onDoubleClick={() => onOpen(frame.id)}
        onMouseDown={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
          }
        }}
        {...longPress.handlers}
        aria-pressed={checked || selected}
        aria-label={`frame ${index + 1}: ${frame.prompt.slice(0, 80)}`}
        title={frame.prompt.slice(0, 120)}
        className={cn(
          "focus-ring relative block h-full w-full overflow-hidden rounded-sm border bg-[color:var(--ink)]/40 transition-colors duration-150 [-webkit-touch-callout:none]",
          stateClass
        )}
        style={{ height: heightPx }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
        />
        <span className="absolute left-1 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] tracking-[0.12em] text-[color:var(--paper)]/85">
          {index + 1}
        </span>
        <span
          className={cn(
            "absolute bottom-1 left-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] tracking-[0.12em]",
            pinned
              ? "text-[color:var(--paper)]"
              : "text-[color:var(--stone)] italic"
          )}
        >
          {formatSeconds(durationMs)}
        </span>
        {isCover && (
          <span className="absolute right-1 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[color:var(--paper)]/85">
            cover
          </span>
        )}
      </button>

      <TileCheck
        checked={checked}
        forceVisible={selecting}
        onCheck={() => onCheck(frame.id)}
      />

      {editable && (
        <>
          <TrimHandle side="left" onResize={onResize} onResizeEnd={onResizeEnd} />
          <TrimHandle
            side="right"
            onResize={onResize}
            onResizeEnd={onResizeEnd}
          />
          <div className="pointer-events-none absolute right-0 top-0 z-10 flex items-center gap-0.5 p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {pinned && onResetDuration && (
              <button
                type="button"
                onClick={() => onResetDuration(frame.id)}
                aria-label="reset to reactive cadence"
                title="reset to reactive cadence"
                className="focus-ring pointer-events-auto rounded-sm bg-[color:var(--ink)]/80 p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--paper)]"
              >
                <RotateCcw className="size-3" strokeWidth={1.5} />
              </button>
            )}
            {onSetCover && !isCover && (
              <button
                type="button"
                onClick={() => onSetCover(frame.id)}
                aria-label="set as cover"
                title="set as cover"
                className="focus-ring pointer-events-auto rounded-sm bg-[color:var(--ink)]/80 p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--paper)]"
              >
                <ImageIcon className="size-3" strokeWidth={1.5} />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(frame.id)}
                aria-label="remove from set"
                className="focus-ring pointer-events-auto rounded-sm bg-[color:var(--ink)]/80 p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--signal)]"
              >
                <X className="size-3" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
};
