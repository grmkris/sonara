"use client";

import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva } from "class-variance-authority";
import type { VariantProps } from "class-variance-authority";
import { isValidElement } from "react";
import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md border border-transparent font-sans text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    defaultVariants: { size: "default", variant: "default" },
    variants: {
      size: {
        default: "h-11 px-4",
        icon: "size-11 p-0",
        lg: "h-12 px-5 text-sm",
        sm: "h-9 px-3 text-xs pointer-coarse:min-h-11",
      },
      variant: {
        default:
          "border-input bg-secondary text-secondary-foreground hover:bg-accent",
        ghost:
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        outline: "border-input bg-transparent text-foreground hover:bg-muted",
        primary: "bg-primary text-primary-foreground hover:bg-primary/90",
        signal: "bg-destructive text-background hover:bg-destructive/90",
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
