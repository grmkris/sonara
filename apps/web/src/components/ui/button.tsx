"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-kaku text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none",
  {
    variants: {
      variant: {
        default:
          "text-[color:var(--paper)]/80 hover:text-[color:var(--paper)] border-b border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]",
        ghost:
          "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
        primary:
          "text-[color:var(--paper)] border-b border-[color:var(--indigo)] hover:border-b-2",
        hanko:
          "text-[color:var(--paper)] bg-[color:var(--hanko)]/90 hover:bg-[color:var(--hanko)] px-3 py-1",
      },
      size: {
        default: "h-7 px-2 py-1",
        sm: "h-6 px-1.5 py-0.5 text-[10px]",
        lg: "h-8 px-3 py-1.5 text-[12px]",
        icon: "h-7 w-7 p-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

interface ButtonProps
  extends ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { buttonVariants };
