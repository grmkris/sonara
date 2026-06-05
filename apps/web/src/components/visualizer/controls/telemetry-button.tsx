"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface TelemetryButtonProps extends Omit<
  ComponentProps<"button">,
  "children"
> {
  icon: ReactNode;
  label: ReactNode;
  // When true, hides the label below sm — useful for icon-only mobile mode.
  hideLabelOnMobile?: boolean;
}

// Compact icon+label control used in the top-right HUD strip
// (record/fullscreen/hide). Consolidates the duplicated className that
// previously lived in each of the three toggles.
export function TelemetryButton({
  icon,
  label,
  className,
  hideLabelOnMobile = true,
  ...rest
}: TelemetryButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "focus-ring pointer-events-auto flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)] transition-colors hover:text-[color:var(--paper)]",
        className
      )}
      {...rest}
    >
      {icon}
      <span className={cn(hideLabelOnMobile && "hidden sm:inline")}>
        {label}
      </span>
    </button>
  );
}
