"use client";

import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import type { FrameSetSummary } from "@sonara/shared";
import { Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { isFramePayload } from "@/lib/curation-dnd";
import { cn } from "@/lib/utils";

// A curated set as a DROP TARGET (sidebar row / drop shelf): dragging frames
// over it rings it in signal and shows "+N"; dropping appends (the page's
// monitor routes it through the undoable addToSet). Also the "new set" target
// flavor that creates a set from the payload.

export const SetDropRow = ({
  set,
  selected,
  onSelect,
  dragCount,
}: {
  set: FrameSetSummary;
  selected: boolean;
  onSelect?: (setId: string) => void;
  // The in-flight payload size (0 = no drag active) — drives the +N badge.
  dragCount: number;
}) => {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    return dropTargetForElements({
      canDrop: ({ source }) => isFramePayload(source.data),
      element: el,
      getData: () => ({ kind: "sidebar-set", name: set.name, setId: set.id }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, [set.id, set.name]);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onSelect ? () => onSelect(set.id) : undefined}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "focus-ring flex w-full items-center gap-3 border-b border-[color:var(--hairline)]/20 px-4 py-2 text-left transition-colors",
        selected ? "bg-[color:var(--paper)]/10" : "hover:bg-[color:var(--paper)]/5",
        isOver &&
          "bg-[color:var(--paper)]/10 ring-1 ring-inset ring-[color:var(--signal)]"
      )}
    >
      {set.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={set.coverUrl}
          alt=""
          loading="lazy"
          className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 object-cover"
        />
      ) : (
        <div className="size-10 shrink-0 rounded-sm border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "truncate font-sans text-[11px] uppercase tracking-[0.16em]",
            selected ? "text-[color:var(--paper)]" : "text-[color:var(--paper)]/80"
          )}
        >
          {set.name}
        </span>
        <span
          className={cn(
            "font-mono text-[9px] uppercase tracking-[0.18em]",
            isOver && dragCount > 0
              ? "text-[color:var(--signal)]"
              : "text-[color:var(--stone)]"
          )}
        >
          {isOver && dragCount > 0
            ? `+${dragCount}`
            : `${set.frameCount} frame${set.frameCount === 1 ? "" : "s"}`}
        </span>
      </div>
    </button>
  );
};

// The "drop to create" flavor — a fresh set from whatever lands on it.
export const NewSetDropRow = ({ dragCount }: { dragCount: number }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  const [isOver, setIsOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    return dropTargetForElements({
      canDrop: ({ source }) => isFramePayload(source.data),
      element: el,
      getData: () => ({ kind: "sidebar-new-set" }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    });
  }, []);

  return (
    <div
      ref={ref}
      className={cn(
        "flex items-center gap-2 border-b border-dashed border-[color:var(--hairline)]/40 px-4 py-3 font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors",
        isOver && "bg-[color:var(--paper)]/10 text-[color:var(--signal)]"
      )}
    >
      <Plus className="size-3" strokeWidth={1.5} />
      {isOver && dragCount > 0
        ? `new set from ${dragCount} frame${dragCount === 1 ? "" : "s"}`
        : "drop here for a new set"}
    </div>
  );
};
