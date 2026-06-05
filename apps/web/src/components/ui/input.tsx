import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const Input = ({ className, ...props }: ComponentProps<"input">) => (
  <input
    className={cn(
      "font-serif block w-full bg-transparent pb-1 pt-0.5 text-[17px] leading-snug text-[color:var(--paper)] caret-[color:var(--indigo)] border-b border-[color:var(--hairline)]/50 transition-colors focus:border-[color:var(--indigo)] focus:outline-none disabled:opacity-50",
      className
    )}
    {...props}
  />
);
