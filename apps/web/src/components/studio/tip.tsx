"use client";

import type { ReactElement } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// House-styled tooltip for the studio: a dark ink popup with a mono uppercase
// label (the same override MusicSource uses). Wrap any single focusable trigger
// — `<Tip text="…"><button …/></Tip>`. The global TooltipProvider lives in the
// root layout, so no provider is needed here.
export const Tip = ({
  text,
  side = "top",
  children,
}: {
  text: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactElement;
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent
      side={side}
      sideOffset={6}
      className="font-mono border border-[color:var(--hairline)]/40 bg-[color:var(--ink)] px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-[color:var(--paper)]"
    >
      {text}
    </TooltipContent>
  </Tooltip>
);
