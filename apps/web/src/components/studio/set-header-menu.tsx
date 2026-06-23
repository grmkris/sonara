"use client";

import { Check, MoreHorizontal, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// The "⋯" overflow menu for the set/recording editor header — holds the
// occasional, secondary actions so the header row stays to its primary cluster
// (share · save). Renders nothing when it would be empty.
export const SetHeaderMenu = ({
  canSelect,
  selectActive,
  onToggleSelect,
  onDelete,
}: {
  // Multi-select arming — the only reliable way to pick frames on touch (no
  // cmd-click / marquee), so it lives here for discoverability.
  canSelect: boolean;
  selectActive: boolean;
  onToggleSelect: () => void;
  onDelete?: () => void;
}) => {
  const [open, setOpen] = useState(false);

  if (!(canSelect || onDelete)) {
    return null;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="more actions">
          <MoreHorizontal className="size-4" strokeWidth={1.5} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-52 p-1">
        {canSelect && (
          <button
            type="button"
            onClick={() => {
              onToggleSelect();
              setOpen(false);
            }}
            aria-pressed={selectActive}
            className="focus-ring flex w-full items-center justify-between gap-2 rounded-[2px] px-2 py-2 text-left font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--paper)]/80 transition-colors hover:bg-[color:var(--paper)]/10 hover:text-[color:var(--paper)]"
          >
            select frames
            {selectActive && (
              <Check
                className="size-3 shrink-0 text-[color:var(--paper)]"
                strokeWidth={1.5}
              />
            )}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => {
              onDelete();
              setOpen(false);
            }}
            className="focus-ring flex w-full items-center gap-2 rounded-[2px] px-2 py-2 text-left font-sans text-[10px] uppercase tracking-[0.22em] text-[color:var(--stone)] transition-colors hover:bg-[color:var(--signal)]/15 hover:text-[color:var(--signal)]"
          >
            <Trash2 className="size-3" strokeWidth={1.5} />
            delete set
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
};
