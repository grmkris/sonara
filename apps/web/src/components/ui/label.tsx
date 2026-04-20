import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "font-sans text-[10px] uppercase tracking-[0.28em] text-[color:var(--stone)]",
        className,
      )}
      {...props}
    />
  );
}
