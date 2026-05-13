"use client";

import { cn } from "@/lib/utils";

interface FieldChipsProps {
  chips: readonly string[];
  active: string;
  onPick: (chip: string) => void;
}

export function FieldChips({ chips, active, onPick }: FieldChipsProps) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip) => {
        const isActive = chip === active;
        return (
          <button
            key={chip}
            type="button"
            onClick={() => onPick(chip)}
            title={chip}
            className={cn(
              "font-sans text-[10px] uppercase tracking-[0.14em] transition-colors border-b px-1.5 py-0.5",
              isActive
                ? "text-[color:var(--paper)] border-[color:var(--paper)]"
                : "text-[color:var(--stone)] border-[color:var(--hairline)]/30 hover:text-[color:var(--paper)] hover:border-[color:var(--paper)]/60",
            )}
          >
            {chip}
          </button>
        );
      })}
    </div>
  );
}
