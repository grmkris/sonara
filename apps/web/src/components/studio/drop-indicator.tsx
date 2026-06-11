"use client";

import { cn } from "@/lib/utils";

// The insertion caret while dragging over the set grid: a 2px signal bar in
// the grid gap on the favored edge of a tile, with a terminal dot up top —
// sonara's hairline/signal vocabulary, no library visuals.
export const DropEdgeIndicator = ({ edge }: { edge: "left" | "right" }) => (
  <div
    aria-hidden
    className={cn(
      "pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-[color:var(--signal)]",
      edge === "left" ? "-left-[5px]" : "-right-[5px]"
    )}
  >
    <span className="absolute -top-1 left-1/2 size-[6px] -translate-x-1/2 rounded-full bg-[color:var(--signal)]" />
  </div>
);
