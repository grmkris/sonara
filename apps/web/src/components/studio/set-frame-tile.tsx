"use client";

import type { LibraryFrame } from "@sonara/shared";
import { Check, ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import type { MouseEvent } from "react";

import { cn } from "@/lib/utils";

interface SetFrameTileProps {
  frame: LibraryFrame;
  index: number;
  selected: boolean;
  isCover: boolean;
  onSelect: (frameId: string) => void;
  // Edit affordances — only rendered when provided (read-only otherwise).
  onMovePrev?: (frameId: string) => void;
  onMoveNext?: (frameId: string) => void;
  onRemove?: (frameId: string) => void;
  onSetCover?: (frameId: string) => void;
  canMovePrev?: boolean;
  canMoveNext?: boolean;
  // Multi-select mode — when on, a click toggles membership instead of
  // opening the inspector.
  selectMode?: boolean;
  checked?: boolean;
  onToggle?: (frameId: string, shiftKey: boolean) => void;
}

// One frame within the set editor grid. Click selects (opens the inspector).
// When edit handlers are passed, hover reveals reorder / remove / set-cover
// controls.
export const SetFrameTile = ({
  frame,
  index,
  selected,
  isCover,
  onSelect,
  onMovePrev,
  onMoveNext,
  onRemove,
  onSetCover,
  canMovePrev,
  canMoveNext,
  selectMode = false,
  checked = false,
  onToggle,
}: SetFrameTileProps) => {
  const editable = !!(onMovePrev || onMoveNext || onRemove || onSetCover);
  const isChecked = selectMode && checked;
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (selectMode && onToggle) {
      onToggle(frame.id, e.shiftKey);
      return;
    }
    onSelect(frame.id);
  };
  let stateClass =
    "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/70";
  if (isChecked) {
    stateClass = "border-[color:var(--signal)] ring-2 ring-[color:var(--signal)]";
  } else if (selected) {
    stateClass = "border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40";
  }
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selectMode ? isChecked : selected}
        aria-label={`frame ${index + 1}: ${frame.prompt.slice(0, 80)}`}
        title={frame.prompt.slice(0, 120)}
        className={cn(
          "focus-ring relative block aspect-square w-full overflow-hidden rounded-sm border bg-[color:var(--ink)]/40 transition-all duration-150",
          stateClass
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={frame.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
        <span className="absolute left-1 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] tracking-[0.12em] text-[color:var(--paper)]/85">
          {index + 1}
        </span>
        {isCover && (
          <span className="absolute right-1 top-1 rounded-sm bg-[color:var(--ink)]/80 px-1 font-mono text-[8px] uppercase tracking-[0.12em] text-[color:var(--paper)]/85">
            cover
          </span>
        )}
        {isChecked && (
          <span className="pointer-events-none absolute bottom-1 right-1 flex size-4 items-center justify-center rounded-sm bg-[color:var(--signal)] text-[color:var(--paper)]">
            <Check className="size-3" strokeWidth={2.5} />
          </span>
        )}
      </button>

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
