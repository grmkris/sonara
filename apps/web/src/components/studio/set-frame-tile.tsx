"use client";

import type { LibraryFrame } from "@sonara/shared";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import type { MouseEvent } from "react";

import { TileCheck } from "@/components/studio/tile-check";
import { useLongPress } from "@/hooks/use-long-press";
import { cn } from "@/lib/utils";

export interface TileClickMods {
  shiftKey: boolean;
  metaOrCtrl: boolean;
}

interface SetFrameTileProps {
  frame: LibraryFrame;
  index: number;
  selected: boolean;
  isCover: boolean;
  // The click matrix lives at the page level — the tile only reports the
  // gesture: onClick (with modifiers), onOpen (double-click — always
  // inspects), onCheck (check-circle / long-press — always toggles).
  onClick: (frameId: string, mods: TileClickMods) => void;
  onOpen: (frameId: string) => void;
  onCheck: (frameId: string) => void;
  checked: boolean;
  // True while a selection is in progress (or pinned) — keeps checks visible.
  selecting: boolean;
  // Edit affordances — only rendered when provided (read-only otherwise).
  onMovePrev?: (frameId: string) => void;
  onMoveNext?: (frameId: string) => void;
  onRemove?: (frameId: string) => void;
  onSetCover?: (frameId: string) => void;
  canMovePrev?: boolean;
  canMoveNext?: boolean;
}

// One frame within the set editor grid. Plain click inspects (or toggles
// while selecting); the hover check-circle, cmd-click and touch long-press
// enter selection; double-click always inspects. When edit handlers are
// passed, hover reveals reorder / remove / set-cover controls.
export const SetFrameTile = ({
  frame,
  index,
  selected,
  isCover,
  onClick,
  onOpen,
  onCheck,
  checked,
  selecting,
  onMovePrev,
  onMoveNext,
  onRemove,
  onSetCover,
  canMovePrev,
  canMoveNext,
}: SetFrameTileProps) => {
  const editable = !!(onMovePrev || onMoveNext || onRemove || onSetCover);
  const longPress = useLongPress(() => onCheck(frame.id));

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (longPress.consumeFired()) {
      return;
    }
    onClick(frame.id, { metaOrCtrl: e.metaKey || e.ctrlKey, shiftKey: e.shiftKey });
  };

  let stateClass =
    "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/70";
  if (checked) {
    stateClass = "border-[color:var(--signal)] ring-2 ring-[color:var(--signal)]";
  } else if (selected) {
    stateClass = "border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40";
  }
  return (
    <div className="group relative" data-frame-tile={frame.id}>
      <button
        type="button"
        onClick={handleClick}
        onDoubleClick={() => onOpen(frame.id)}
        // Shift-click must not smear browser text selection across the grid.
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
          "focus-ring relative block aspect-square w-full overflow-hidden rounded-sm border bg-[color:var(--ink)]/40 transition-all duration-150 [-webkit-touch-callout:none]",
          stateClass
        )}
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
        <span className="absolute left-7 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] tracking-[0.12em] text-[color:var(--paper)]/85">
          {index + 1}
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
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-0.5 bg-gradient-to-t from-[color:var(--ink)]/95 to-transparent p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="flex items-center gap-0.5">
            {onMovePrev && (
              <button
                type="button"
                onClick={() => onMovePrev(frame.id)}
                disabled={!canMovePrev}
                aria-label="move earlier"
                className="focus-ring pointer-events-auto rounded-sm p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--paper)] disabled:opacity-30"
              >
                <ChevronLeft className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
            {onMoveNext && (
              <button
                type="button"
                onClick={() => onMoveNext(frame.id)}
                disabled={!canMoveNext}
                aria-label="move later"
                className="focus-ring pointer-events-auto rounded-sm p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--paper)] disabled:opacity-30"
              >
                <ChevronRight className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-0.5">
            {onSetCover && !isCover && (
              <button
                type="button"
                onClick={() => onSetCover(frame.id)}
                aria-label="set as cover"
                title="set as cover"
                className="focus-ring pointer-events-auto rounded-sm p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--paper)]"
              >
                <ImageIcon className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={() => onRemove(frame.id)}
                aria-label="remove from set"
                className="focus-ring pointer-events-auto rounded-sm p-0.5 text-[color:var(--paper)]/85 hover:text-[color:var(--signal)]"
              >
                <X className="size-3.5" strokeWidth={1.5} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
