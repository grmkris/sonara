"use client";

import type { LibraryFrame } from "@sonara/shared";
import { useCallback } from "react";
import type { MouseEvent } from "react";

import { TileCheck } from "@/components/studio/tile-check";
import type { TileClickMods } from "@/components/studio/set-frame-tile";
import { useLongPress } from "@/hooks/use-long-press";
import { formatMmSs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

interface FrameCardProps {
  frame: LibraryFrame;
  selected: boolean;
  // Gesture reporting — the click matrix is resolved at the page level.
  onClick: (frameId: string, mods: TileClickMods) => void;
  onOpen: (frameId: string) => void;
  onCheck: (frameId: string) => void;
  checked: boolean;
  selecting: boolean;
  // Absolute position on the timeline axis (0..100, as a percentage).
  leftPct: number;
  // Vertical stacking offset for clustered frames (0 = primary row,
  // 1+ = stacked rows below).
  stackIdx: number;
  size: number;
}

// A single 48×48 (configurable) thumbnail positioned absolutely on the
// timeline by its `leftPct`. Plain click inspects (or toggles while
// selecting); check-circle / cmd-click / long-press select; double-click
// always inspects. Hover scales + reveals tMs.
export const FrameCard = ({
  frame,
  selected,
  onClick,
  onOpen,
  onCheck,
  checked,
  selecting,
  leftPct,
  stackIdx,
  size,
}: FrameCardProps) => {
  const longPress = useLongPress(() => onCheck(frame.id));

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (longPress.consumeFired()) {
        return;
      }
      onClick(frame.id, {
        metaOrCtrl: e.metaKey || e.ctrlKey,
        shiftKey: e.shiftKey,
      });
    },
    [frame.id, onClick, longPress]
  );

  const tMsLabel = formatMmSs(frame.tMs);
  let stateClass =
    "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/80";
  if (checked) {
    stateClass = "z-10 border-[color:var(--signal)] ring-2 ring-[color:var(--signal)]";
  } else if (selected) {
    stateClass = "z-10 border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40";
  }

  return (
    <div
      data-frame-tile={frame.id}
      className="group absolute top-0"
      style={{
        height: size,
        left: `${leftPct}%`,
        transform: `translateX(-50%) translateY(${stackIdx * (size + 4)}px)`,
        width: size,
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={() => onOpen(frame.id)}
        onMouseDown={(e) => {
          if (e.shiftKey) {
            e.preventDefault();
          }
        }}
        {...longPress.handlers}
        aria-label={`frame at ${tMsLabel}: ${frame.prompt.slice(0, 80)}`}
        aria-pressed={checked || selected}
        title={`${tMsLabel} · ${frame.prompt.slice(0, 100)}`}
        className={cn(
          "focus-ring block h-full w-full overflow-hidden rounded-sm",
          "border bg-[color:var(--ink)]/40 transition-all duration-150",
          "hover:z-10 hover:scale-[1.08] [-webkit-touch-callout:none]",
          stateClass
        )}
      >
        <img
          src={frame.url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
        />
        <span
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0",
            "bg-gradient-to-t from-[color:var(--ink)]/90 to-transparent",
            "px-1 py-0.5 font-mono text-[8px] uppercase tracking-[0.14em]",
            "text-[color:var(--paper)]/90 opacity-0 transition-opacity",
            "group-hover:opacity-100",
            selected && "opacity-100"
          )}
        >
          {tMsLabel}
        </span>
      </button>
      <TileCheck
        checked={checked}
        forceVisible={selecting}
        onCheck={() => onCheck(frame.id)}
      />
    </div>
  );
};
