"use client";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface DemoBadgeProps {
  label: string;
  tooltip: string;
  active: boolean;
}

// Small outline badge with a tooltip — used for the DEMO mode status
// chips ("no fal" / "no credits"). Folded out of demo-mode-toggle.tsx
// where the same block was duplicated twice.
export function DemoBadge({ label, tooltip, active }: DemoBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "font-mono h-[14px] rounded-sm border-[color:var(--hairline)]/40 px-1 text-[8px] uppercase tracking-[0.18em]",
            active
              ? "text-[color:var(--paper)]/80"
              : "text-[color:var(--stone)]/60",
          )}
        >
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="font-mono bg-[color:var(--ink)] text-[color:var(--paper)] border border-[color:var(--hairline)]/40 px-2 py-0.5 text-[10px] tracking-[0.14em]"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
