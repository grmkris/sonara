"use client";

import { Check } from "lucide-react";

import type { TileClickMods } from "@/lib/curation-dnd";
import { cn } from "@/lib/utils";

// The implicit-selection entry point on every frame tile: a check-circle that
// appears on hover/focus (desktop), stays faintly visible on touch devices
// (no hover to reveal it — this replaces the old mode toggle as the mobile
// entry), and is always shown while a selection is in progress. Clicking it
// toggles WITHOUT opening the inspector (caller stops propagation).
export const TileCheck = ({
  checked,
  onCheck,
  forceVisible,
}: {
  checked: boolean;
  // Modifiers ride along so a SHIFT-click on the check ranges (like the clip
  // body) instead of just toggling the one frame.
  onCheck: (mods: TileClickMods) => void;
  // True while selecting (selection non-empty or pinned) — checks stay up.
  forceVisible: boolean;
}) => (
  <button
    type="button"
    aria-label={checked ? "deselect frame" : "select frame"}
    aria-pressed={checked}
    onClick={(e) => {
      e.stopPropagation();
      onCheck({ metaOrCtrl: e.metaKey || e.ctrlKey, shiftKey: e.shiftKey });
    }}
    onDoubleClick={(e) => e.stopPropagation()}
    className={cn(
      "focus-ring absolute left-1 top-1 z-10 flex size-5 items-center justify-center rounded-full border transition-opacity",
      checked
        ? "border-[color:var(--signal)] bg-[color:var(--signal)] text-[color:var(--paper)] opacity-100"
        : "border-[color:var(--paper)]/60 bg-[color:var(--ink)]/60 text-[color:var(--paper)]/80 backdrop-blur-[2px]",
      // Hidden until tile hover/focus on fine pointers; faintly visible
      // always on touch (no hover there — it's the entry affordance).
      forceVisible || checked
        ? "opacity-100"
        : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-60"
    )}
  >
    <Check className="size-3" strokeWidth={2.5} />
  </button>
);
