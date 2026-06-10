"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

// Header pill that arms multi-select on a frame surface (recording timeline /
// set editor). Active state is signal-tinted; toggling off clears the
// selection (the page owns that).
export const SelectModeToggle = ({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={active}
    className={cn(
      "focus-ring font-sans inline-flex items-center gap-1.5 border px-3 py-1.5 text-[10px] uppercase tracking-[0.22em] transition-colors",
      active
        ? "border-[color:var(--signal)] text-[color:var(--signal)] hover:border-[color:var(--signal)]"
        : "border-[color:var(--hairline)]/40 text-[color:var(--paper)]/85 hover:border-[color:var(--paper)]/70 hover:text-[color:var(--paper)]"
    )}
  >
    <Check className="size-3" strokeWidth={1.5} />
    select
  </button>
);
