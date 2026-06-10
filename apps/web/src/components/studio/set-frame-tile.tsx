"use client";

import type { LibraryFrame } from "@sonara/shared";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";

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
}: SetFrameTileProps) => {
  const editable = !!(onMovePrev || onMoveNext || onRemove || onSetCover);
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => onSelect(frame.id)}
        aria-pressed={selected}
        aria-label={`frame ${index + 1}: ${frame.prompt.slice(0, 80)}`}
        title={frame.prompt.slice(0, 120)}
        className={cn(
          "focus-ring relative block aspect-square w-full overflow-hidden rounded-sm border bg-[color:var(--ink)]/40 transition-all duration-150",
          selected
            ? "border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40"
            : "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/70"
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
