"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { isValidElement } from "react";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-sans text-[11px] uppercase tracking-[0.14em] transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-7 px-2 py-1",
        icon: "h-7 w-7 p-0",
        lg: "h-8 px-3 py-1.5 text-[12px]",
        sm: "h-6 px-1.5 py-0.5 text-[10px]",
      },
      variant: {
        default:
          "text-[color:var(--paper)]/80 hover:text-[color:var(--paper)] border-b border-[color:var(--hairline)]/40 hover:border-[color:var(--paper)]",
        ghost: "text-[color:var(--stone)] hover:text-[color:var(--paper)]",
        primary:
          "text-[color:var(--paper)] border-b border-[color:var(--indigo)] hover:border-b-2",
        signal:
          "text-[color:var(--paper)] bg-[color:var(--signal)]/90 hover:bg-[color:var(--signal)] px-3 py-1",
      },
    },
  }
);

interface ButtonProps
  extends ButtonPrimitive.Props, VariantProps<typeof buttonVariants> {
  // Preserve the old Radix `asChild` API: when set, render the single child
  // element (e.g. <Link>/<a>) via Base UI's `render` prop. `render` is also
  // accepted directly for new call sites.
  asChild?: boolean;
}

export const Button = ({
  className,
  variant,
  size,
  asChild,
  render,
  children,
  ...props
}: ButtonProps) => {
  const renderEl =
    asChild && isValidElement(children) ? (children as ReactElement) : render;
  return (
    <ButtonPrimitive
      className={cn(buttonVariants({ className, size, variant }))}
      data-slot="button"
      // When rendering as an anchor/Link (asChild or render), it's not a native
      // <button>, so disable Base UI's nativeButton behaviour for correct a11y.
      nativeButton={renderEl === undefined || renderEl === null}
      render={renderEl}
      {...props}
    >
      {asChild ? undefined : children}
    </ButtonPrimitive>
  );
};

export { buttonVariants };
