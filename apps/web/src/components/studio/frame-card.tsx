"use client";

import type { LibraryFrame } from "@sonara/shared";
import { Check } from "lucide-react";
import { useCallback } from "react";
import type { MouseEvent } from "react";

import { formatMmSs } from "@/lib/format-time";
import { cn } from "@/lib/utils";

interface FrameCardProps {
  frame: LibraryFrame;
  selected: boolean;
  onSelect: (frameId: string) => void;
  // Absolute position on the timeline axis (0..100, as a percentage).
  leftPct: number;
  // Vertical stacking offset for clustered frames (0 = primary row,
  // 1+ = stacked rows below).
  stackIdx: number;
  size: number;
  // Multi-select mode — when on, a click toggles membership instead of
  // opening the inspector. Optional so non-studio callers are untouched.
  selectMode?: boolean;
  checked?: boolean;
  onToggle?: (frameId: string, shiftKey: boolean) => void;
}

// A single 48×48 (configurable) thumbnail positioned absolutely on the
// timeline by its `leftPct`. Clicking selects the frame. Hover scales +
// reveals tMs. Stacked frames (when timestamps cluster) sit beneath the
// primary row with a hairline connector.
export const FrameCard = ({
  frame,
  selected,
  onSelect,
  leftPct,
  stackIdx,
  size,
  selectMode = false,
  checked = false,
  onToggle,
}: FrameCardProps) => {
  const onClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (selectMode && onToggle) {
        onToggle(frame.id, e.shiftKey);
        return;
      }
      onSelect(frame.id);
    },
    [frame.id, onSelect, onToggle, selectMode]
  );

  const tMsLabel = formatMmSs(frame.tMs);
  const isChecked = selectMode && checked;
  let stateClass =
    "border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]/80";
  if (isChecked) {
    stateClass = "z-10 border-[color:var(--signal)] ring-2 ring-[color:var(--signal)]";
  } else if (selected) {
    stateClass = "z-10 border-[color:var(--paper)] ring-2 ring-[color:var(--paper)]/40";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`frame at ${tMsLabel}: ${frame.prompt.slice(0, 80)}`}
      aria-pressed={selectMode ? isChecked : selected}
      title={`${tMsLabel} · ${frame.prompt.slice(0, 100)}`}
      className={cn(
        "focus-ring group absolute top-0 overflow-hidden rounded-sm",
        "border bg-[color:var(--ink)]/40 transition-all duration-150",
        "hover:z-10 hover:scale-[1.08]",
        stateClass
      )}
      style={{
        height: size,
        left: `${leftPct}%`,
        transform: `translateX(-50%) translateY(${stackIdx * (size + 4)}px)`,
        width: size,
      }}
    >
      <img
        src={frame.url}
        alt=""
        loading="lazy"
        decoding="async"
        className="h-full w-full object-cover"
      />
      {isChecked && (
        <span className="pointer-events-none absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-sm bg-[color:var(--signal)] text-[color:var(--paper)]">
          <Check className="size-2.5" strokeWidth={2.5} />
        </span>
      )}
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
  );
};
