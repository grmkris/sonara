"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

// Base UI slider. External API matches the old Radix wrapper — array `value`,
// `onValueChange(number[])`, `min/max/step`, plus any forwarded props (pointer
// handlers, aria-label) land on Root — so call sites are unchanged.
export function Slider({
  className,
  ...props
}: ComponentProps<typeof SliderPrimitive.Root>) {
  return (
    <SliderPrimitive.Root
      className={cn(
        "relative flex w-full touch-none select-none items-center",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Control className="flex w-full grow items-center">
        <SliderPrimitive.Track className="relative h-px w-full grow bg-[color:var(--hairline)]/50">
          <SliderPrimitive.Indicator className="absolute h-full bg-[color:var(--paper)]/70" />
          <SliderPrimitive.Thumb className="block h-2 w-2 rounded-full bg-[color:var(--paper)] shadow-[0_0_0_4px_rgba(26,22,18,0.4)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--indigo)]" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
