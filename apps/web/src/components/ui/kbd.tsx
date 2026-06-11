import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface KbdProps {
  children: ReactNode;
  className?: string;
}

export const Kbd = ({ children, className }: KbdProps) => (
  <kbd
    className={cn(
      "font-mono inline-flex h-[14px] min-w-[14px] items-center justify-center rounded-[2px] border border-[color:var(--hairline)]/40 bg-[color:var(--ink)]/40 px-[3px] text-[9px] uppercase leading-none tracking-[0.08em] text-[color:var(--paper)]/85",
      className
    )}
  >
    {children}
  </kbd>
);
